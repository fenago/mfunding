import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";

const SignUpPage = () => {
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
    setStatus("Creating account...");
    const { error } = await supabase.auth.signUp({
      email: formValues.email,
      password: formValues.password,
    });
    if (error) {
      alert(error.message);
    }
    setStatus("");
  };

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <Link className="absolute top-6 left-6 text-ocean-blue hover:text-deep-sea transition-colors" to="/">
        ◄ Home
      </Link>
      <form className="w-full max-w-md flex flex-col gap-4 card p-8" onSubmit={handleSubmit}>
        <h1 className="heading-3 text-midnight-blue text-center mb-2">Sign Up</h1>
        <p className="text-center text-body-sm text-text-secondary mb-2">
          Demo app, please don't use your real email or password
        </p>
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
        <button className="btn-primary w-full" type="submit">Create Account</button>
        <Link className="text-center text-ocean-blue hover:text-deep-sea transition-colors text-sm" to="/auth/sign-in">
          Already have an account? Sign In
        </Link>
        {status && <p className="text-center text-text-secondary">{status}</p>}
      </form>
    </main>
  );
};

export default SignUpPage;
