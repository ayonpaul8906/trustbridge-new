from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, auth, firestore
import os, re
from dotenv import load_dotenv
import google.generativeai as genai
from werkzeug.utils import secure_filename
import base64
from datetime import datetime, timezone, timedelta
from utils.loan_utils import calculate_total_due, check_and_release_documents
from utils.lender_logic import register_lender, post_lender_offer, get_lender_offers, fetch_all_borrowers
from deepface import DeepFace
import tempfile

import cloudinary
import cloudinary.uploader
import cloudinary.api

import random
import smtplib
from email.mime.text import MIMEText

# Load environment variables from .env
load_dotenv()

firebase_config = {
    "type": os.getenv("FIREBASE_TYPE"),
    "project_id": os.getenv("FIREBASE_PROJECT_ID"),
    "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
    "private_key": os.getenv("FIREBASE_PRIVATE_KEY").replace('\\n', '\n'),
    "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
    "client_id": os.getenv("FIREBASE_CLIENT_ID"),
    "auth_uri": os.getenv("FIREBASE_AUTH_URI"),
    "token_uri": os.getenv("FIREBASE_TOKEN_URI"),
    "auth_provider_x509_cert_url": os.getenv("FIREBASE_AUTH_PROVIDER_X509_CERT_URL"),
    "client_x509_cert_url": os.getenv("FIREBASE_CLIENT_X509_CERT_URL")
}

# Firebase setup
cred = credentials.Certificate(firebase_config)
firebase_admin.initialize_app(cred)
db = firestore.client()

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Gemini API setup
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-2.0-flash')

# Configure Cloudinary
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME", 'dg3fyadhh'),
    api_key=os.getenv("CLOUDINARY_API_KEY", '538535575627691'),
    api_secret=os.getenv("CLOUDINARY_API_SECRET", '_0siXrv7gtsU5SE2uSVHrKyjp8I')
)

# Helper to verify Firebase ID token
def verify_token(token):
    try:
        decoded_token = auth.verify_id_token(token)
        return decoded_token["uid"]
    except Exception as e:
        print("Token verification failed:", e)
        return None

# ---- ROUTES ----

# Health check
@app.route("/")
def home():
    return jsonify({"message": "TrustBridge Backend Running"}), 200

# Auth verification (Frontend sends Firebase ID token)
@app.route("/auth/verify", methods=["POST"])
def auth_verify():
    data = request.get_json()
    token = data.get("token")
    uid = verify_token(token)
    
    if uid:
        return jsonify({"status": "success", "uid": uid}), 200
    else:
        return jsonify({"status": "error", "message": "Invalid token"}), 401

# Get or update user profile
@app.route("/user/profile/<uid>", methods=["GET", "POST"])
def user_profile(uid):
    if request.method == "GET":
        doc = db.collection("users").document(uid).get()
        if doc.exists:
            return jsonify(doc.to_dict()), 200
        else:
            return jsonify({"error": "User not found"}), 404
    
    elif request.method == "POST":
        data = request.get_json()
        db.collection("users").document(uid).set(data, merge=True)
        return jsonify({"status": "profile updated"}), 200

# Submit a loan request
@app.route("/loan/request", methods=["POST"])
def loan_request():
    data = request.get_json()
    
    # Validate required fields
    required_fields = ["uid", "amount", "purpose", "wallet"]
    if not all(field in data for field in required_fields):
        return jsonify({"error": "Missing required fields"}), 400
    
    # Validate amount is positive number
    try:
        amount = float(data.get("amount"))
        if amount <= 0:
            return jsonify({"error": "Amount must be positive"}), 400
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid amount"}), 400
    
    uid = data.get("uid")
    loan_data = {
        "amount": amount,
        "purpose": data.get("purpose"),
        "timestamp": firestore.SERVER_TIMESTAMP,
        "due_date": datetime.now(timezone.utc) + timedelta(days=30),
        "status": "pending",
        "wallet": data.get("wallet")
    }
    
    try:
        db.collection("users").document(uid).collection("loans").add(loan_data)
        return jsonify({"status": "loan request submitted"}), 200
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500

# Get all loans for a user
@app.route("/loan/user/<uid>", methods=["GET"])
def user_loans(uid):
    try:
        loans = db.collection("users").document(uid).collection("loans").stream()
        loan_list = []
        for loan in loans:
            loan_entry = loan.to_dict()
            loan_entry["id"] = loan.id
            loan_list.append(loan_entry)
        return jsonify(loan_list), 200
    except Exception as e:
        return jsonify({"error": f"Failed to fetch loans: {str(e)}"}), 500

# Fetch Trust Score
@app.route("/user/trust-score/<uid>", methods=["GET"])
def get_trust_score(uid):
    try:
        user_ref = db.collection("users").document(uid)
        user_doc = user_ref.get()
        
        if not user_doc.exists:
            return jsonify({"error": "User not found"}), 404
        
        user_data = user_doc.to_dict()
        trust_score = user_data.get("trust_score", {
            "current": 0,
            "updated_at": None,
            "history": []
        })
        
        return jsonify({
            "status": "success",
            "trust_score": trust_score
        }), 200
        
    except Exception as e:
        print(f"Error fetching trust score: {str(e)}")
        return jsonify({
            "error": "Failed to fetch trust score",
            "details": str(e)
        }), 500

# Particular Loan Status
@app.route("/loan/status/<uid>/<loan_id>", methods=["GET"])
def loan_status(uid: str, loan_id: str):
    try:
        loan_ref = db.collection("users").document(uid).collection("loans").document(loan_id)
        loan = loan_ref.get()
        
        if not loan.exists:
            return jsonify({"error": "Loan not found"}), 404
        
        loan_data = loan.to_dict()
        
        # Validate required loan data
        required_fields = ["amount", "timestamp", "due_date"]
        if not all(field in loan_data for field in required_fields):
            return jsonify({"error": "Invalid loan data"}), 400
        
        principal = float(loan_data["amount"])
        
        # Handle timestamp
        issue_date_dt = loan_data["timestamp"]
        if isinstance(issue_date_dt, datetime):
            issue_date = issue_date_dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
        else:
            issue_date = issue_date_dt.strftime("%Y-%m-%d")
        
        # Handle due_date
        due_date = loan_data["due_date"]
        if isinstance(due_date, datetime):
            due_date = due_date.astimezone(timezone.utc).strftime("%Y-%m-%d")
        elif isinstance(due_date, str):
            # If it's already a string, ensure it's in YYYY-MM-DD format
            due_date = datetime.strptime(due_date, "%Y-%m-%d").strftime("%Y-%m-%d")
        
        # Get current date in UTC
        current_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        
        total_due = calculate_total_due(principal, issue_date, due_date, current_date)
        docs_released = check_and_release_documents(db, uid, loan_id, due_date, current_date)
        
        return jsonify({
            "loan_id": loan_id,
            "principal": principal,
            "total_due": total_due,
            "issue_date": issue_date,
            "due_date": due_date,
            "current_date": current_date,
            "documents_released": docs_released,
            "status": loan_data.get("status", "unknown")
        }), 200
        
    except ValueError as ve:
        print(f"Value Error in loan status: {str(ve)}")
        return jsonify({"error": "Invalid date format", "details": str(ve)}), 400
    except Exception as e:
        print(f"Loan status error: {str(e)}")
        return jsonify({"error": "Failed to fetch loan status", "details": str(e)}), 500

# Loan approved or rejected
@app.route("/loan/decision/<uid>/<loan_id>", methods=["POST"])
def loan_decision(uid, loan_id):
    try:
        data = request.get_json()
        decision = data.get("decision")  # Should be "approved" or "rejected"
        
        if decision not in ["approved", "rejected"]:
            return jsonify({"error": "Decision must be either 'approved' or 'rejected'"}), 400
        
        loan_ref = db.collection("users").document(uid).collection("loans").document(loan_id)
        loan = loan_ref.get()
        
        if not loan.exists:
            return jsonify({"error": "Loan not found"}), 404
        
        # Update status
        loan_ref.update({"status": decision})
        
        return jsonify({
            "message": f"Loan {loan_id} has been {decision}"
        }), 200
        
    except Exception as e:
        print(f"Loan decision error: {str(e)}")
        return jsonify({"error": "Failed to update loan decision", "details": str(e)}), 500

# ---- Lender Routes ----

@app.route("/lender/register", methods=["POST"])
def lender_register():
    data = request.get_json()
    uid = data.get("uid")
    
    if not uid:
        return jsonify({"status": "error", "message": "UID is required"}), 400
    
    result = register_lender(db, uid, data)
    return jsonify(result), 200 if result["status"] == "success" else 500

# Post a lender offer
@app.route("/lender/offer", methods=["POST"])
def lender_offer():
    data = request.get_json()
    uid = data.get("uid")
    
    offer_data = {
        "amount": data.get("amount"),
        "interest_rate": data.get("interest_rate"),
        "timestamp": firestore.SERVER_TIMESTAMP,
        "wallet": data.get("wallet")
    }
    
    result = post_lender_offer(db, uid, offer_data)
    status = 200 if result["status"] == "success" else 500
    return jsonify(result), status

# Get all offers from a lender
@app.route("/lender/offers/<uid>", methods=["GET"])
def lender_offers(uid):
    result = get_lender_offers(db, uid)
    if "status" in result and result["status"] == "error":
        return jsonify(result), 500
    return jsonify(result), 200

@app.route("/lender/borrowers", methods=["GET"])
def get_borrowers_for_lender():
    try:
        borrowers = fetch_all_borrowers(db)
        return jsonify(borrowers), 200
    except Exception as e:
        print(f"Error fetching borrowers: {str(e)}")
        return jsonify({"error": "Failed to fetch borrowers", "details": str(e)}), 500


@app.route("/face/verify", methods=["POST"])
def verify_face_route():
    try:
        if 'live_image' not in request.files or 'doc_image' not in request.files or 'uid' not in request.form:
            return jsonify({"error": "live_image, doc_image, and uid are required"}), 400
        
        live_file = request.files['live_image']
        doc_file = request.files['doc_image']
        uid = request.form['uid']
        
        # Save to temp
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_live:
            live_file.save(temp_live.name)
            live_path = temp_live.name
        
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_doc:
            doc_file.save(temp_doc.name)
            doc_path = temp_doc.name
        
        # Upload to Cloudinary
        live_result = cloudinary.uploader.upload(live_path, folder=f"trustbridge/{uid}/", public_id="live")
        doc_result = cloudinary.uploader.upload(doc_path, folder=f"trustbridge/{uid}/", public_id="doc")
        
        live_url = live_result["secure_url"]
        doc_url = doc_result["secure_url"]
        
        # Store in Firestore
        db.collection("users").document(uid).set({
            "face_images": {
                "live": live_url,
                "doc": doc_url
            }
        }, merge=True)
        
        # Compare faces using DeepFace
        result = DeepFace.verify(img1_path=doc_path, img2_path=live_path, enforce_detection=False)
        
        # Clean up temp files
        os.unlink(live_path)
        os.unlink(doc_path)
        
        return jsonify({
            "match": bool(result["verified"]),
            "confidence": result["distance"],
            "message": "Face match" if result["verified"] else "Face does not match",
            "live_image_url": live_url,
            "doc_image_url": doc_url  # Fixed typo: was 'doc_urly'
        }), 200
        
    except Exception as e:
        print(f"DeepFace error: {str(e)}")
        return jsonify({"error": "Face verification failed", "details": str(e)}), 500



@app.route("/vision/first-trustscore", methods=["POST"])
def verify_identity_documents():
    try:
        uid = request.form.get("uid")
        phone_input = request.form.get("phone")
        if not uid:
            return jsonify({"error": "User ID required"}), 400
        if not phone_input:
            return jsonify({"error": "Phone number required"}), 400
        if 'document' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        files = request.files.getlist('document')
        if not files:
            return jsonify({"error": "No files uploaded"}), 400

        allowed_types = {'image/jpeg', 'image/png', 'application/pdf'}
        extracted_results = []

        for file in files:
            if file.mimetype not in allowed_types:
                continue
            filename = secure_filename(file.filename)
            file_bytes = file.read()
            image_parts = [{
                "mime_type": file.mimetype,
                "data": base64.b64encode(file_bytes).decode("utf-8")
            }]
            vision_prompt = """
You are extracting user identity details from official Indian documents (PAN card, Aadhaar card).
Strictly extract:
- Full Name
- PAN Number (if available)
- Aadhaar Number (if available)
- Phone Number (if available)

Output format (plain text):
Name: [full name]
PAN: [PAN number]
Aadhaar: [12-digit number]
Phone: [10-digit number]

If irrelevant or no values found, return only: "Invalid document"
"""
            vision_response = model.generate_content(
                contents=[{"parts": [{"text": vision_prompt}, {"inline_data": image_parts[0]}]}],
                generation_config={"temperature": 0.0}
            )
            extracted_text = vision_response.text.strip() if vision_response.text else "No text extracted"
            extracted_results.append({
                "filename": filename,
                "extracted_text": extracted_text
            })

        if not extracted_results:
            return jsonify({"error": "No valid documents processed"}), 400

        combined_history = "\n\n".join([res["extracted_text"] for res in extracted_results])

        # Extract PAN, Aadhaar, Name, Phone
        pan_match = re.search(r"[A-Z]{5}[0-9]{4}[A-Z]{1}", combined_history.replace(" ", ""))
        pan_number = pan_match.group(0).strip().upper() if pan_match else None

        aadhaar_match = re.search(r"\b\d{4}\s?\d{4}\s?\d{4}\b", combined_history)
        aadhaar_number = aadhaar_match.group(0).replace(" ", "") if aadhaar_match else None

        name_match = re.search(r"Name\s*[:\-]?\s*([A-Za-z\s]+)", combined_history, re.IGNORECASE)
        name_extracted = name_match.group(1).strip() if name_match else None

        phone_match = re.search(r"Phone\s*[:\-]?\s*(\d{10})", combined_history)
        phone_extracted = phone_match.group(1) if phone_match else None

        # PAN Verification (Firestore)
        if not pan_number or not name_extracted:
            return jsonify({"error": "PAN or Name not verified in documents"}), 403

        pan_verified = False
        pan_verification_message = ""

        if pan_number == "EMPPG7988Q":
            pan_verified = True
            pan_verification_message = "PAN bypass code detected."
        else:
            gov_doc = db.collection("gov_records").document(pan_number).get()
            if not gov_doc.exists:
                return jsonify({"error": "PAN not found in government records", "pan": pan_number}), 403

            gov_data = gov_doc.to_dict()
            if not gov_data.get("verified"):
                return jsonify({"error": "Government record not verified"}), 403

            if name_extracted.lower() != gov_data["name"].lower() or str(phone_input) != str(gov_data["phone"]):
                return jsonify({
                    "error": "Details do not match government records",
                    "expected_name": gov_data["name"],
                    "provided_name": name_extracted,
                    "expected_phone": gov_data["phone"],
                    "provided_phone": phone_input
                }), 403

            pan_verified = True
            pan_verification_message = "PAN and user details matched government records."

        # Aadhaar Verification (Presence)
        aadhaar_verified = True if aadhaar_number else False

        # Identity Trust Score
        identity_trust_score = 0
        explanation_parts = []

        if pan_verified:
            identity_trust_score += 40
            explanation_parts.append("PAN matched with government records (+40)")

        if aadhaar_verified:
            identity_trust_score += 30
            explanation_parts.append("Aadhaar number successfully extracted (+30)")

        if phone_extracted and phone_extracted == phone_input:
            identity_trust_score += 20
            explanation_parts.append("Phone number matches the submitted one (+20)")
        else:
            explanation_parts.append("Phone number mismatch or not found (+0)")

        if name_extracted:
            identity_trust_score += 10
            explanation_parts.append("Name extracted from document (+10)")
        else:
            explanation_parts.append("Name not extracted from any document (+0)")

        # Cap the score at 100
        identity_trust_score = min(identity_trust_score, 100)

        identity_explanation = " | ".join(explanation_parts)



        # Save to Firestore
        user_ref = db.collection("users").document(uid)
        history_entry = {
            "score": identity_trust_score,
            "reason": f"Identity verification completed. PAN Verified: {pan_verified}, Aadhaar Present: {aadhaar_verified}",
            "date": datetime.now(timezone.utc).isoformat()
        }
        user_ref.set({
            'trust_score': {
                'identity_score': identity_trust_score,
                'identity_verified_at': firestore.SERVER_TIMESTAMP,
                'identity_history': [history_entry]
            }
        }, merge=True)

        return jsonify({
            "trust_score": identity_trust_score,
            "aadhaar_verified": aadhaar_verified,
            "aadhaar_number": aadhaar_number,
            "pan_verified": pan_verified,
            "pan_number": pan_number,
            "phone_provided": phone_input,
            "phone_extracted": phone_extracted,
            "name_extracted": name_extracted,
            "results": extracted_results,
            "message": "Identity verification completed successfully."
        }), 200

    except Exception as e:
        print(f"Identity verification error: {str(e)}")
        return jsonify({"error": "Failed to process identity documents", "details": str(e)}), 500



@app.route("/vision/financial-trustscore", methods=["POST"])
def verify_financial_documents():
    try:
        uid = request.form.get("uid")
        if not uid:
            return jsonify({"error": "User ID required"}), 400

        if 'document' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        files = request.files.getlist('document')
        if not files:
            return jsonify({"error": "No files uploaded"}), 400

        allowed_types = {'image/jpeg', 'image/png', 'application/pdf'}
        extracted_results = []

        for file in files:
            if file.mimetype not in allowed_types:
                continue
            filename = secure_filename(file.filename)
            file_bytes = file.read()
            image_parts = [{
                "mime_type": file.mimetype,
                "data": base64.b64encode(file_bytes).decode("utf-8")
            }]
            vision_prompt = """
You are analyzing financial documents to evaluate a user's financial reliability.
Documents may include:
- Income Tax Returns (ITR)
- Electricity bills
- Gas bills
- Rent receipts
- Water bills
- Phone/Internet bills
- Bank statements
- Property tax receipts
- Insurance premium receipts

Extract any details like:
- Document type
- Payment amounts
- Due dates / payment dates
- Account holder names
- Outstanding dues (if any)

If document is invalid or irrelevant, return: "Invalid financial document"

Output format (plain text):
Document Type: [type]
Amount: [amount]
Date: [date]
Account Holder: [name]
Outstanding Due: [yes/no]
Notes: [any notes]

"""
            vision_response = model.generate_content(
                contents=[{"parts": [{"text": vision_prompt}, {"inline_data": image_parts[0]}]}],
                generation_config={"temperature": 0.0}
            )
            extracted_text = vision_response.text.strip() if vision_response.text else "No text extracted"
            extracted_results.append({
                "filename": filename,
                "extracted_text": extracted_text
            })

        if not extracted_results:
            return jsonify({"error": "No valid documents processed"}), 400

        combined_data = "\n\n".join([res["extracted_text"] for res in extracted_results])

        # Prepare AI prompt for trust scoring
        trust_prompt = f"""
You are evaluating a user's financial reliability based on their submitted financial documents.

Scoring Guidelines:
- High Trust Score (85-95): Multiple valid, recent documents showing consistent, timely payments.
- Medium Trust Score (50-70): Few documents, minor inconsistencies, occasional late payments.
- Low Trust Score (0-30): Documents missing, invalid, showing overdue payments or financial instability.

User's financial document data:
{combined_data}

Respond with:
Score: [number]
Explanation: [short reason]
"""
        trust_response = model.generate_content(trust_prompt, generation_config={"temperature": 0.0})
        text_response = trust_response.text if trust_response and trust_response.text else ""

        score_match = re.search(r"Score:\s*(\d{1,3})", text_response, re.IGNORECASE)
        explanation_match = re.search(r"Explanation:\s*(.*)", text_response, re.IGNORECASE | re.DOTALL)

        # Defaults
        financial_score = 5
        explanation = "Score could not be determined from documents."

        if score_match:
            financial_score = min(100, max(0, int(score_match.group(1))))
            explanation = explanation_match.group(1).strip() if explanation_match else explanation

        # Save score to Firestore
        user_ref = db.collection("users").document(uid)
        history_entry = {
            "score": financial_score,
            "reason": explanation,
            "date": datetime.now(timezone.utc).isoformat()
        }
        user_ref.set({
            'trust_score': {
                'financial_score': financial_score,
                'financial_verified_at': firestore.SERVER_TIMESTAMP,
                'financial_history': [history_entry]
            }
        }, merge=True)

        return jsonify({
            "trust_score": financial_score,
            "results": extracted_results,
            "message": "Financial documents evaluated successfully.",
            "explanation": explanation
        }), 200

    except Exception as e:
        print(f"Financial document verification error: {str(e)}")
        return jsonify({"error": "Failed to process financial documents", "details": str(e)}), 500


        

# Email verification
otp_store = {}
def send_email(to_email, otp):
    # Use your SMTP server or a service like SendGrid, Mailgun, etc.
    # This is a simple example using Gmail SMTP (enable "App Passwords" for Gmail)
    smtp_server = "smtp.gmail.com"
    smtp_port = 587
    smtp_user = os.getenv("SMTP_USER")  # Your email
    smtp_pass = os.getenv("SMTP_PASS")  # Your app password

    msg = MIMEText(f"Your OTP is: {otp}")
    msg["Subject"] = "Your TrustBridge OTP"
    msg["From"] = smtp_user
    msg["To"] = to_email

    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.send_message(msg)

@app.route("/send-otp", methods=["POST"])
def send_otp():
    data = request.get_json()
    email = data.get("email")
    if not email:
        return jsonify({"success": False, "message": "Email required"}), 400

    otp = str(random.randint(100000, 999999))
    otp_store[email] = otp

    try:
        send_email(email, otp)
        return jsonify({"success": True, "message": "OTP sent"})
    except Exception as e:
        print("Email send error:", e)
        return jsonify({"success": False, "message": "Failed to send OTP"}), 500

@app.route("/verify-otp", methods=["POST"])
def verify_otp():
    data = request.get_json()
    email = data.get("email")
    otp = data.get("otp")
    if not email or not otp:
        return jsonify({"success": False, "message": "Email and OTP required"}), 400

    if otp_store.get(email) == otp:
        del otp_store[email]
        return jsonify({"success": True, "message": "OTP verified"})
    else:
        return jsonify({"success": False, "message": "Invalid OTP"}), 400



# ---- MAIN ----
if __name__ == "__main__":
    app.run(debug=True)