import React, { useState } from "react";
import DashboardWrapper from "../../components/shared/DashboardWrapper";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { db } from "../../firebase";
import { doc, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { HandCoins, Percent, MapPin } from "lucide-react";
import { motion } from "framer-motion";

const LenderPreferencesForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    maxAmount: "",
    interestRate: "",
    location: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;

    let warningText = "";
    if (name === "maxAmount" && parseFloat(value) > MAX_LEND_AMOUNT) {
      warningText = `Maximum allowed is ${MAX_LEND_AMOUNT} ETH`;
    }
    if (name === "interestRate" && parseFloat(value) > MAX_INTEREST_RATE) {
      warningText = `Maximum allowed is ${MAX_INTEREST_RATE}%`;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    setWarnings((prev) => ({
      ...prev,
      [name]: warningText,
    }));
  };

  const MAX_LEND_AMOUNT = 0.5; // in ETH
  const MAX_INTEREST_RATE = 10; // in %

  const [warnings, setWarnings] = useState({
    maxAmount: "",
    interestRate: "",
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    const amount = parseFloat(formData.maxAmount);
    const interest = parseFloat(formData.interestRate);

    if (amount > MAX_LEND_AMOUNT || interest > MAX_INTEREST_RATE) {
      alert(
        `⚠️ Lend amount cannot exceed ${MAX_LEND_AMOUNT} ETH and interest rate must be ≤ ${MAX_INTEREST_RATE}%.`
      );
      setSubmitting(false);
      return;
    }

    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        alert("You must be signed in to save preferences.");
        setSubmitting(false);
        return;
      }

      const userId = user.uid;
      const lenderDocRef = doc(db, "lenders", userId);
      await setDoc(lenderDocRef, formData, { merge: true });

      setFormData({ name: "", maxAmount: "", interestRate: "", location: "" });
      alert("Lender preferences saved successfully!");
    } catch (err) {
      console.error("Error saving preferences:", err);
      alert("Something went wrong. Try again.");
    }

    setSubmitting(false);
  };

  // const handleSubmit = async (e) => {
  //   e.preventDefault();
  //   setSubmitting(true);

  //   try {
  //     const auth = getAuth();
  //     const user = auth.currentUser;

  //     if (!user) {
  //       alert("You must be signed in to save preferences.");
  //       setSubmitting(false);
  //       return;
  //     }

  //     const userId = user.uid;
  //     const lenderDocRef = doc(db, "lenders", userId);
  //     await setDoc(lenderDocRef, formData, { merge: true });

  //     setFormData({ name: "", maxAmount: "", interestRate: "", location: "" });
  //     alert("Lender preferences saved successfully!");
  //   } catch (err) {
  //     console.error("Error saving preferences:", err);
  //     alert("Something went wrong. Try again.");
  //   }

  //   setSubmitting(false);
  // };

  return (
    <DashboardWrapper>
      <motion.h1
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-3xl font-extrabold mb-8 text-center text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-teal-400"
      >
        Set Your Lending Preferences
      </motion.h1>

      <motion.form
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 max-w-xl mx-auto space-y-6 shadow-2xl"
      >
        {[
          {
            label: "Name",
            name: "name",
            placeholder: "Your name (optional)",
            icon: null,
            type: "text",
            required: false,
          },
          {
            label: "Max Lend Amount",
            name: "maxAmount",
            placeholder: "e.g., 0.01 ETH",
            icon: <HandCoins size={16} className="text-yellow-400" />,
            type: "number",
            required: true,
          },
          {
            label: "Interest Rate (%)",
            name: "interestRate",
            placeholder: "e.g., 5",
            icon: <Percent size={16} className="text-blue-400" />,
            type: "number",
            required: true,
          },
          {
            label: "Location",
            name: "location",
            placeholder: "City or region (optional)",
            icon: <MapPin size={16} className="text-red-400" />,
            type: "text",
            required: false,
          },
        ].map((field) => (
          <div key={field.name} className="relative group">
            <label className="text-sm font-semibold text-gray-300 flex items-center gap-2 mb-1">
              {field.icon}
              {field.label}
            </label>
            <Input
              name={field.name}
              type={field.type}
              value={formData[field.name]}
              onChange={handleChange}
              placeholder={field.placeholder}
              required={field.required}
              className="mt-1 transition-all duration-300 focus:ring-2 focus:ring-teal-400 bg-gray-800 text-white border-gray-700"
            />
            {warnings[field.name] && (
              <p className="text-sm text-red-500 mt-1">
                {warnings[field.name]}
              </p>
            )}
          </div>
        ))}

        <motion.div
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="mt-6"
        >
          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-gradient-to-r from-green-500 to-teal-500 hover:from-green-600 hover:to-teal-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold tracking-wide transition-all duration-300"
          >
            {submitting ? "Saving..." : "Save Preferences"}
          </Button>
        </motion.div>
      </motion.form>
    </DashboardWrapper>
  );
};

export default LenderPreferencesForm;