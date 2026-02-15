import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import { SignInPageSEO } from "../../components/seo/SEO";

const SignInPage = () => {
  // ==============================
  // If user is already logged in, redirect to home
  // This logic is being repeated in SignIn and SignUp..
  const { session } = useSession();
  if (session) return <Navigate to="/" />;
  // maybe we can create a wrapper component for these pages
  // just like the ./router/AuthProtectedRoute.tsx? up to you.
  // ==============================
  const [status, setStatus] = useState("");
  const [formValues, setFormValues] = useState({
    email: "",
    password: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormValues({ ...formValues, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("Logging in...");
    const { error } = await supabase.auth.signInWithPassword({
      email: formValues.email,
      password: formValues.password,
    });
    if (error) {
      alert(error.message);
    }
    setStatus("");
  };
  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col items-center justify-center p-6">
      <SignInPageSEO />
      <Link className="absolute top-6 left-6 text-ocean-blue hover:text-deep-sea transition-colors" to="/">
        ◄ Home
      </Link>
      <form className="w-full max-w-md flex flex-col gap-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-8" onSubmit={handleSubmit}>
        <h1 className="heading-3 text-gray-900 dark:text-white text-center mb-4">Sign In</h1>
        <input
          className="input-field"
          name="email"
          onChange={handleInputChange}
          type="email"
          placeholder="Email"
        />
        <input
          className="input-field"
          name="password"
          onChange={handleInputChange}
          type="password"
          placeholder="Password"
        />
        <button className="btn-primary w-full" type="submit">Login</button>
        <Link className="text-center text-ocean-blue hover:text-mint-green transition-colors text-sm" to="/auth/sign-up">
          Don't have an account? Sign Up
        </Link>
        {status && <p className="text-center text-gray-500 dark:text-gray-400">{status}</p>}
      </form>
    </main>
  );
};

export default SignInPage;
