import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "../ui/form";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Checkbox } from "../ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { toast } from "react-toastify";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth, db } from "../../firebase";
import { doc, setDoc } from "firebase/firestore";


const signInSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const signUpSchema = z
  .object({
    fullName: z.string().min(2, "Name must be at least 2 characters"),
    dateOfBirth: z
      .string()
      .regex(/^\d{2}\/\d{2}\/\d{4}$/, "Invalid date format (DD/MM/YYYY)"),
    gender: z.enum(["male", "female", "other", "prefer_not_say"]),
    phone: z.string().min(10, "Phone number must be at least 10 digits"),
    email: z.string().email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
        "Password must contain at least one uppercase letter, one lowercase letter, one number and one special character"
      ),
    confirmPassword: z.string(),
    monthlyIncome: z.enum(["below_5k", "5k_10k", "10k_20k", "above_20k"]),
    education: z.enum(["none", "primary", "secondary", "graduate"]),
    loanPurpose: z.string().min(1, "Loan purpose is required"),
    agreement: z.boolean().refine((val) => val === true, {
      message: "You must agree to the terms",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords must match",
    path: ["confirmPassword"],
  });

export default function BorrowerAuthPage() {
  const navigate = useNavigate();

  const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

  const [isLoading, setIsLoading] = useState(false);
  const [panImage, setPanImage] = useState(null);
  const [selfieImage, setSelfieImage] = useState(null);
  const [verificationMessage, setVerificationMessage] = useState("");
  const [isVerified, setIsVerified] = useState(false);

  // Camera modal state
  const [showCamera, setShowCamera] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // OTP states
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);

  // PAN Loader
  const [panVerificationLoading, setPanVerificationLoading] = useState(false);

  const signInForm = useForm({
    resolver: zodResolver(signInSchema),
  });

  const signUpForm = useForm({
    resolver: zodResolver(signUpSchema),
    defaultValues: {
      agreement: false,
      gender: "prefer_not_say",
    },
  });

  // Camera modal handlers
  const openCamera = async () => {
    setCameraError("");
    setShowCamera(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      setCameraError("Unable to access camera.");
    }
  };

  const captureSelfie = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        setSelfieImage(new File([blob], "selfie.jpg", { type: "image/jpeg" }));
        setShowCamera(false);
        // Stop camera stream
        if (video.srcObject) {
          video.srcObject.getTracks().forEach((track) => track.stop());
        }
      }, "image/jpeg");
    }
  };

  const closeCamera = () => {
    setShowCamera(false);
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
    }
  };

  // OTP handlers
  const handleSendOtp = async () => {
    const email = signUpForm.getValues("email");
    if (!email) {
      toast.error("Please enter your email first.");
      return;
    }
    setOtpLoading(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/send-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        }
      );
      const data = await res.json();
      if (data.success) {
        setOtpSent(true);
        toast.success("OTP sent to your email.");
      } else {
        toast.error(data.message || "Failed to send OTP.");
      }
    } catch (err) {
      toast.error("Failed to send OTP.");
    }
    setOtpLoading(false);
  };

  const handleVerifyOtp = async () => {
    const email = signUpForm.getValues("email");
    if (!otpInput) {
      toast.error("Please enter the OTP.");
      return;
    }
    setOtpLoading(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/verify-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, otp: otpInput }),
        }
      );
      const data = await res.json();
      if (data.success) {
        setOtpVerified(true);
        toast.success("Email verified!");
      } else {
        setOtpVerified(false);
        toast.error(data.message || "Invalid OTP.");
      }
    } catch (err) {
      toast.error("Failed to verify OTP.");
    }
    setOtpLoading(false);
  };

  async function onSignIn(values) {
    setIsLoading(true);
    try {
      const { email, password } = values;
      const userCredential = await signInWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;
      toast.success("Successfully signed in!", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } catch (error) {
      toast.error("Sign in failed", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function verifyPan() {
    if (!panImage || !selfieImage) {
      toast.error("Please upload PAN image and capture a selfie.", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
      return;
    }

    const fullName = signUpForm.getValues("fullName");
    const phone = signUpForm.getValues("phone");

    if (!fullName || !phone) {
      toast.error("Please fill in your full name and phone number.", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
      return;
    }

    const formData = new FormData();
    formData.append("fullName", fullName);
    formData.append("phone", phone);
    formData.append("live_image", selfieImage);
    formData.append("doc_image", panImage);

    // ADD THIS:
    const user = auth.currentUser;
    const uid = user ? user.uid : "test_uid";
    formData.append("uid", uid);

    // Loading Start
    setPanVerificationLoading(true);

    try {
      const response = await fetch(
        `https://bzn05lgb-5000.inc1.devtunnels.ms//face/verify`,
        {
          method: "POST",
          body: formData,
        }
      );

      const data = await response.json();
      setVerificationMessage(data.message);

      if (data.match) {
        setIsVerified(true);
        toast.success("PAN verification successful!", {
          position: "top-right",
          autoClose: 3000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
        });
      } else {
        setIsVerified(false);
        toast.error(data.message, {
          position: "top-right",
          autoClose: 3000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
        });
      }
    } catch (error) {
      toast.error("Verification failed. Please try again.", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } finally {
      // Stop loading
      setPanVerificationLoading(false);
    }
  }

  async function onSignUp(values) {
    if (!otpVerified) {
      toast.error("Please verify your email with OTP before proceeding.", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
      return;
    }
    if (!isVerified) {
      toast.error("Please verify your PAN before proceeding.", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
      return;
    }

    setIsLoading(true);
    try {
      const { email, password } = values;
      const { confirmPassword, password: _, ...userData } = values;

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );
      const user = userCredential.user;
      const userId = user.uid;

      // Store in Firestore under "users" collection
      await setDoc(doc(db, "users", userId), {
        ...userData,
        createdAt: new Date().toISOString(),
        role: "borrower",
      });

      toast.success("Account created Successfully!", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } catch (error) {
      // Show specific error message
      let errorMessage = "Registration failed";

      switch (error.code) {
        case "auth/email-already-in-use":
          errorMessage = "This email is already registered";
          break;
        case "auth/invalid-email":
          errorMessage = "Invalid email address";
          break;
        case "auth/operation-not-allowed":
          errorMessage = "Email/password accounts are not enabled";
          break;
        case "auth/weak-password":
          errorMessage = "Password is too weak";
          break;
        default:
          errorMessage = error.message;
      }
      toast.error(errorMessage, {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
        progress: undefined,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full py-10 relative overflow-hidden bg-gradient-to-b from-gray-900 to-black">
      {/* Camera Modal */}
      {showCamera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-gray-900 rounded-lg p-6 flex flex-col items-center">
            <video ref={videoRef} className="w-64 h-48 rounded mb-4" autoPlay />
            <canvas ref={canvasRef} style={{ display: "none" }} />
            {cameraError && <p className="text-red-400">{cameraError}</p>}
            <div className="flex gap-4">
              <Button onClick={captureSelfie} className="bg-blue-600">
                Capture
              </Button>
              <Button onClick={closeCamera} className="bg-gray-700">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-4 top-1/4 h-[500px] w-[500px] rounded-full bg-purple-500/10 blur-[100px] animate-pulse" />
        <div className="absolute -right-4 top-1/2 h-[400px] w-[400px] rounded-full bg-blue-500/10 blur-[100px] animate-pulse delay-1000" />
      </div>

      <div className="container max-w-lg mx-auto px-4 relative z-10">
        <Card className="border border-gray-800/50 bg-black/40 backdrop-blur-xl shadow-xl">
          <CardHeader className="space-y-4 pb-8 border-b border-gray-800/50">
            <CardTitle className="text-3xl font-bold text-center bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              TrustBridge Borrower Portal
            </CardTitle>
            <CardDescription className="text-center text-gray-400 text-lg">
              Access affordable financial solutions
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-8">
            <Tabs defaultValue="signin" className="space-y-8">
              <TabsList className="grid w-full grid-cols-2 bg-gray-900/30 rounded-lg p-1">
                <TabsTrigger
                  value="signin"
                  className="rounded-md transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-blue-500 data-[state=active]:text-white"
                >
                  Login
                </TabsTrigger>
                <TabsTrigger
                  value="signup"
                  className="rounded-md transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-blue-500 data-[state=active]:text-white"
                >
                  Register
                </TabsTrigger>
              </TabsList>

              {/* Sign In Form */}
              <TabsContent value="signin">
                <Form {...signInForm}>
                  <form
                    onSubmit={signInForm.handleSubmit(onSignIn)}
                    className="space-y-6"
                  >
                    <FormField
                      name="email"
                      control={signInForm.control}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-200">Email</FormLabel>
                          <FormControl>
                            <Input
                              className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                              placeholder="name@example.com"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage className="text-red-400" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      name="password"
                      control={signInForm.control}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-gray-200">
                            Password
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                              placeholder="••••••••"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage className="text-red-400" />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-11 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium rounded-lg shadow-lg hover:shadow-purple-500/20 transition-all duration-200"
                    >
                      {isLoading ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 border-2 border-white/30 border-t-white animate-spin rounded-full" />
                          Signing in...
                        </span>
                      ) : (
                        "Login"
                      )}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              {/* Sign Up Form */}
              <TabsContent value="signup">
                <Form {...signUpForm}>
                  <form
                    onSubmit={signUpForm.handleSubmit(onSignUp)}
                    className="space-y-6"
                  >
                    {/* Personal Information */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-gray-400">
                        Personal Information
                      </h3>
                      <div className="grid gap-4">
                        <FormField
                          name="fullName"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Full Name
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  placeholder="As per your official ID"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-red-400" />
                            </FormItem>
                          )}
                        />
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField
                            name="dateOfBirth"
                            control={signUpForm.control}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-200">
                                  Date of Birth
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                    placeholder="DD/MM/YYYY"
                                    {...field}
                                  />
                                </FormControl>
                                <FormMessage className="text-red-400" />
                              </FormItem>
                            )}
                          />
                          <FormField
                            name="gender"
                            control={signUpForm.control}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-200">
                                  Gender
                                </FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  defaultValue={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger className="bg-gray-900/30 text-gray-100 border-gray-700/50 hover:border-purple-500/30 transition-colors">
                                      <SelectValue placeholder="Select gender" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent className="bg-gray-900 border-gray-700">
                                    <SelectItem value="male">Male</SelectItem>
                                    <SelectItem value="female">
                                      Female
                                    </SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                    <SelectItem value="prefer_not_say">
                                      Prefer not to say
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage className="text-red-400" />
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Contact Information */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-gray-400">
                        Contact Information
                      </h3>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          name="email"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Email
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  placeholder="name@example.com"
                                  type="email"
                                  {...field}
                                  disabled={otpVerified}
                                />
                              </FormControl>
                              <FormMessage className="text-red-400" />
                              {/* OTP Button and Input */}
                              {!otpVerified && (
                                <div className="mt-2 flex flex-col gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="w-fit bg-gradient-to-r from-purple-500 to-blue-500"
                                    onClick={handleSendOtp}
                                    disabled={otpLoading || otpSent}
                                  >
                                    {otpLoading
                                      ? "Sending OTP..."
                                      : otpSent
                                      ? "OTP Sent"
                                      : "Get OTP"}
                                  </Button>
                                  {otpSent && (
                                    <div className="flex gap-2 items-center">
                                      <Input
                                        type="text"
                                        placeholder="Enter OTP"
                                        value={otpInput}
                                        onChange={(e) =>
                                          setOtpInput(e.target.value)
                                        }
                                        className="w-32"
                                      />
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="bg-blue-600"
                                        onClick={handleVerifyOtp}
                                        disabled={otpLoading || otpVerified}
                                      >
                                        Verify OTP
                                      </Button>
                                    </div>
                                  )}
                                  {otpVerified && (
                                    <span className="text-green-400 text-xs">
                                      Email verified!
                                    </span>
                                  )}
                                </div>
                              )}
                            </FormItem>
                          )}
                        />
                        <FormField
                          name="phone"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Phone
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  placeholder="+91 9999999999"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-red-400" />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Security */}
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium text-gray-400">
                        Security
                      </h3>
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField
                          name="password"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Password
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="password"
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  placeholder="••••••••"
                                  {...field}
                                />
                              </FormControl>
                              <FormDescription className="text-xs text-gray-400">
                                Must be at least 8 characters with 1 uppercase,
                                1 lowercase, 1 number and 1 special character
                              </FormDescription>
                              <FormMessage className="text-red-400" />
                            </FormItem>
                          )}
                        />
                        <FormField
                          name="confirmPassword"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Confirm Password
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="password"
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  placeholder="••••••••"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-red-400" />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Financial Information */}
                    <div className="space-y-4 p-4 rounded-lg bg-gray-900/20 border border-gray-800/30">
                      <h3 className="text-sm font-medium text-purple-400 flex items-center gap-2">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
                          <path
                            fillRule="evenodd"
                            d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Financial Details
                      </h3>
                      <div className="grid gap-4">
                        <FormField
                          name="panImage"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Upload PAN Image
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="file"
                                  accept="image/*"
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  onChange={(e) =>
                                    setPanImage(e.target.files[0])
                                  }
                                />
                              </FormControl>
                              <FormMessage className="text-red-400" />
                            </FormItem>
                          )}
                        />
                        {/* Selfie Capture Section */}
                        <div>
                          <label className="text-gray-200 block mb-2">
                            Capture Selfie (Live)
                          </label>
                          <Button
                            type="button"
                            onClick={openCamera}
                            className="mb-2 bg-gradient-to-r from-purple-500 to-blue-500"
                          >
                            Open Camera
                          </Button>
                          {selfieImage && (
                            <div className="mt-2">
                              <img
                                src={URL.createObjectURL(selfieImage)}
                                alt="Selfie Preview"
                                className="w-24 h-24 rounded-full object-cover border-2 border-purple-500"
                              />
                            </div>
                          )}
                        </div>
                        <Button
                          type="button"
                          onClick={verifyPan}
                          disabled={panVerificationLoading || isVerified}
                          className={`w-full h-11 font-medium rounded-lg shadow-lg transition-all duration-200 ${
                            isVerified
                              ? "bg-green-600 hover:bg-green-600 text-white"
                              : "bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white hover:shadow-purple-500/20"
                          }`}
                        >
                          {panVerificationLoading ? (
                            <span className="flex items-center gap-2">
                              <span className="h-4 w-4 border-2 border-white/30 border-t-white animate-spin rounded-full" />
                              Verifying PAN...
                            </span>
                          ) : isVerified ? (
                            <span className="flex items-center gap-2">
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                              Verified
                            </span>
                          ) : (
                            "Verify PAN"
                          )}
                        </Button>
                        <p className="text-sm text-gray-400 mt-2">
                          {verificationMessage}
                        </p>
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField
                            name="monthlyIncome"
                            control={signUpForm.control}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-200">
                                  Monthly Income
                                </FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  defaultValue={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger className="bg-gray-900/30 text-gray-100 border-gray-700/50 hover:border-purple-500/30 transition-colors">
                                      <SelectValue placeholder="Select range" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent className="bg-gray-900 border-gray-700">
                                    <SelectItem value="below_5k">
                                      Below ₹5,000
                                    </SelectItem>
                                    <SelectItem value="5k_10k">
                                      ₹5,000 - ₹10,000
                                    </SelectItem>
                                    <SelectItem value="10k_20k">
                                      ₹10,000 - ₹20,000
                                    </SelectItem>
                                    <SelectItem value="above_20k">
                                      Above ₹20,000
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage className="text-red-400" />
                              </FormItem>
                            )}
                          />
                          <FormField
                            name="education"
                            control={signUpForm.control}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel className="text-gray-200">
                                  Education Level
                                </FormLabel>
                                <Select
                                  onValueChange={field.onChange}
                                  defaultValue={field.value}
                                >
                                  <FormControl>
                                    <SelectTrigger className="bg-gray-900/30 text-gray-100 border-gray-700/50 hover:border-purple-500/30 transition-colors">
                                      <SelectValue placeholder="Select level" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent className="bg-gray-900 border-gray-700">
                                    <SelectItem value="none">None</SelectItem>
                                    <SelectItem value="primary">
                                      Primary
                                    </SelectItem>
                                    <SelectItem value="secondary">
                                      Secondary
                                    </SelectItem>
                                    <SelectItem value="graduate">
                                      Graduate
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage className="text-red-400" />
                              </FormItem>
                            )}
                          />
                        </div>
                        <FormField
                          name="loanPurpose"
                          control={signUpForm.control}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-200">
                                Loan Purpose
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="bg-gray-900/30 text-gray-100 border-gray-700/50 focus:border-purple-500/50 focus:ring-purple-500/20"
                                  placeholder="Brief description of loan purpose"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage className="text-red-400" />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>

                    {/* Agreement */}
                    <FormField
                      name="agreement"
                      control={signUpForm.control}
                      render={({ field }) => (
                        <FormItem className="flex items-start space-x-3 p-4 rounded-lg bg-purple-500/5 border border-purple-500/10">
                          <FormControl>
                            <div className="h-5 w-5 relative">
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                                className="h-5 w-5 border-2 border-gray-500/50 bg-gray-900/30 rounded-sm absolute inset-0
              data-[state=checked]:border-purple-500 data-[state=checked]:bg-purple-500"
                              />
                              {field.value && (
                                <svg
                                  className="h-5 w-5 absolute inset-0 text-white pointer-events-none"
                                  fill="none"
                                  strokeWidth="2"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    d="M5 13l4 4L19 7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </div>
                          </FormControl>
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <FormLabel className="text-sm text-gray-300 leading-tight">
                                I agree to TrustBridge's terms and policies
                              </FormLabel>
                            </div>
                            <p className="text-xs text-gray-400">
                              By checking this box, you agree to our lending
                              guidelines, data privacy policy, and code of
                              conduct
                            </p>
                              <button
                                type="button"
                                onClick={() =>
                                  window.open("/terms-and-conditions", "_blank")
                                }
                                className="text-xs text-purple-400 hover:text-purple-300 underline underline-offset-2 transition-colors"
                              >
                                Read Guidelines
                              </button>
                          </div>
                          <FormMessage className="text-red-400" />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full h-11 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white font-medium rounded-lg shadow-lg hover:shadow-purple-500/20 transition-all duration-200"
                    >
                      {isLoading ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 border-2 border-white/30 border-t-white animate-spin rounded-full" />
                          Creating account...
                        </span>
                      ) : (
                        "Register as Borrower"
                      )}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}