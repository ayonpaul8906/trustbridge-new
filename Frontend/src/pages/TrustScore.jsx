import React, { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { UploadCloud, FileCheck2, Loader2 } from "lucide-react";
import { toast } from "react-toastify";
import { auth } from "../firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import DashboardWrapper from "../components/shared/DashboardWrapper";

export default function TrustScore() {
  const [user] = useAuthState(auth);
  const [aadhar, setAadhar] = useState(null);
  const [pan, setPan] = useState(null);
  const [phone, setPhone] = useState("");
  const [verified, setVerified] = useState(false);
  const [financialDocs, setFinancialDocs] = useState([]);
  const [trustScore, setTrustScore] = useState(0);
  const [animatedScore, setAnimatedScore] = useState(0);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const BACKEND_URL = "https://bzn05lgb-5000.inc1.devtunnels.ms";
  const fileInputRef = useRef();

  // Animate trust score
  useEffect(() => {
    const interval = setInterval(() => {
      setAnimatedScore((prev) => {
        if (prev < trustScore) return prev + 1;
        if (prev > trustScore) return prev - 1;
        return prev;
      });
    }, 20);
    return () => clearInterval(interval);
  }, [trustScore]);

  const handleVerification = async () => {
    if (!aadhar || !pan || phone.length !== 10) {
      toast.error(
        "Please upload Aadhaar, PAN, and enter a valid mobile number."
      );
      return;
    }
    setVerifying(true);
    try {
      const formData = new FormData();
      formData.append("uid", user?.uid || "");
      formData.append("phone", phone);
      formData.append("document", aadhar);
      formData.append("document", pan);

      const response = await fetch(`${BACKEND_URL}/vision/first-trustscore`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      // Log extracted results for debugging
      if (data.results) {
        data.results.forEach((res, idx) => {
          console.log(
            `Document ${idx + 1} (${res.filename}) extracted:`,
            res.extracted_text
          );
        });
      }

      if (response.ok && !data.error) {
        setVerified(true);
        setTrustScore(data.trust_score || 0);
        toast.success("Identity verified!");
      } else {
        setVerified(false);
        toast.error(data.error || "Verification failed.");
      }
    } catch (error) {
      setVerified(false);
      toast.error("Verification failed.");
    } finally {
      setVerifying(false);
    }
  };

  // Upload handler for financial docs
  const handleFinancialDocs = (e) => {
    if (!verified) {
      toast.info("Please complete identity verification first.");
      return;
    }
    // Allow multiple uploads by appending new files
    const newFiles = Array.from(e.target.files || []);
    setFinancialDocs((prev) => [...prev, ...newFiles]);
    // Reset input so same file can be re-uploaded if needed
    e.target.value = "";
  };

  // Remove a file from the list
  const removeFinancialDoc = (index) => {
    setFinancialDocs((prev) => prev.filter((_, i) => i !== index));
  };

  // Next button: generate trust score
  const handleNext = async () => {
  if (!verified) {
    toast.error("Please complete identity verification first.");
    return;
  }
  if (!user) {
    toast.error("Please login first.");
    return;
  }
  if (financialDocs.length === 0) {
    toast.error("Please upload at least one financial document.");
    return;
  }
  setLoading(true);
  const formData = new FormData();
  formData.append("uid", user.uid);
  financialDocs.forEach((file) => formData.append("document", file));
  try {
    const response = await fetch(`${BACKEND_URL}/vision/financial-trustscore`, {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (response.ok) {
      setTrustScore(data.trust_score);
      toast.success("Trust score generated!");
    } else {
      throw new Error(data.error || "Failed to process documents");
    }
  } catch (error) {
    toast.error(error.message || "Failed to upload documents");
  } finally {
    setLoading(false);
  }
};

  // Handle click on disabled file input
  const handleFinancialDocsClick = (e) => {
    if (!verified) {
      e.preventDefault();
      toast.info("Please complete identity verification first.");
    }
  };

  return (
    <DashboardWrapper>
      <div className="min-h-screen flex flex-col lg:flex-row gap-12 items-start justify-center bg-gradient-to-br from-gray-950 to-gray-900 py-12">
        {/* Left: Identity & Financial Docs */}
        <motion.div
          className="bg-[#101624] rounded-3xl p-10 shadow-2xl w-full max-w-lg flex flex-col gap-10 border border-gray-800"
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div>
            <h2 className="text-2xl font-bold text-white mb-8 tracking-tight">
              Identity Verification
            </h2>
            <div className="flex flex-col gap-6">
              {/* Aadhaar Upload */}
              <div>
                <label className="text-gray-300 mb-2 block font-medium">
                  Aadhaar Card
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setAadhar(e.target.files[0])}
                  className="hidden"
                  id="aadhar-upload"
                  disabled={verified}
                />
                <label
                  htmlFor="aadhar-upload"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-700 text-white cursor-pointer hover:bg-cyan-600 transition font-medium shadow ${
                    verified ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                >
                  <UploadCloud className="mr-2" />{" "}
                  {aadhar ? aadhar.name : "Upload Aadhaar"}
                </label>
              </div>
              {/* PAN Upload */}
              <div>
                <label className="text-gray-300 mb-2 block font-medium">
                  PAN Card
                </label>
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setPan(e.target.files[0])}
                  className="hidden"
                  id="pan-upload"
                  disabled={verified}
                />
                <label
                  htmlFor="pan-upload"
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-700 text-white cursor-pointer hover:bg-cyan-600 transition font-medium shadow ${
                    verified ? "opacity-60 cursor-not-allowed" : ""
                  }`}
                >
                  <UploadCloud className="mr-2" />{" "}
                  {pan ? pan.name : "Upload PAN"}
                </label>
              </div>
              {/* Phone */}
              <div>
                <label className="text-gray-300 mb-2 block font-medium">
                  Mobile Number
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  maxLength={10}
                  disabled={verified}
                  className="bg-gray-800 text-white rounded-lg px-3 py-2 w-full border border-gray-700 focus:border-cyan-500 outline-none font-medium"
                  placeholder="Enter 10-digit number"
                />
              </div>
              {/* Verify Button */}
              <button
                onClick={handleVerification}
                disabled={verifying || verified}
                className={`w-full py-3 rounded-lg font-semibold mt-2 text-lg shadow transition ${
                  verified
                    ? "bg-green-600 text-white cursor-not-allowed"
                    : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white"
                }`}
              >
                {verifying ? "Verifying..." : verified ? "Verified" : "Verify"}
              </button>
            </div>
          </div>
          {/* Financial Docs */}
          <div>
            <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">
              Financial Documents
            </h2>
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              multiple
              ref={fileInputRef}
              onChange={handleFinancialDocs}
              onClick={handleFinancialDocsClick}
              disabled={!verified || loading}
              className="w-full text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:bg-cyan-700 file:text-white hover:file:bg-cyan-600"
              style={{ cursor: !verified ? "not-allowed" : "pointer" }}
            />
            <div className="mt-3 space-y-2">
              {financialDocs.map((doc, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-gray-300 bg-gray-800/70 p-2 rounded-lg"
                >
                  <FileCheck2 className="w-4 h-4 text-green-400" />
                  {doc.name}
                </div>
              ))}
            </div>
            <button
              onClick={handleNext}
              disabled={!verified || loading || financialDocs.length === 0}
              className="w-full mt-6 py-3 rounded-lg font-semibold text-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-700 hover:to-blue-700 transition shadow"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              ) : (
                "Next"
              )}
            </button>
          </div>
        </motion.div>
        {/* Right: Trust Score */}
        <motion.div
          className="bg-[#101624] rounded-3xl p-10 shadow-2xl w-full max-w-lg flex flex-col items-center justify-center border border-gray-800"
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-bold mb-2 text-white tracking-tight">
            Trust Score
          </h2>
          <div className="relative w-48 h-48 mx-auto my-8">
            <div className="absolute inset-0 rounded-full border-4 border-gray-700" />
            <motion.div
              className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center"
              animate={{ scale: [0.95, 1.05, 1] }}
              transition={{
                duration: 0.8,
                repeat: Infinity,
                repeatType: "mirror",
              }}
            >
              <div className="text-6xl font-bold text-cyan-400">
                {animatedScore}
              </div>
              <div className="text-base text-gray-400">/ 100</div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </DashboardWrapper>
  );
}

