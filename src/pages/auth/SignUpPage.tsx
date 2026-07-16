import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useSession } from "../../context/SessionContext";
import supabase from "../../supabase";
import { SignUpPageSEO } from "../../components/seo/SEO";
import OSAuthShell from "../../components/landing/os/trust/OSAuthShell";

// Reskin to the Momentum OS design — auth logic (signUp, redirect) unchanged.
const SignUpPage = () => {
  // ==============================
  // If user is already logged in, redirect to home
  // This logic is being repeated in SignIn and SignUp..
  const { session } = useSession();
  // maybe we can create a wrapper component for these pages
  // just like the ./router/AuthProtectedRoute.tsx? up to you.
  // ==============================
  const [status, setStatus] = useState("");
  const [formValues, setFormValues] = useState({
    email: "",
    password: "",
  });

  // Hooks are declared above the guard so they run in a stable order every render.
  if (session) return <Navigate to="/" />;

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
    <OSAuthShell>
      <SignUpPageSEO />
      <form className="os-authcard" onSubmit={handleSubmit}>
        <h1 className="os-auth-title">Create your account</h1>
        <p className="os-auth-sub">Track your application and manage your documents in one place.</p>
        <div className="os-su-fields">
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
          <button className="btn-primary w-full" type="submit">Create account</button>
          <Link className="os-auth-link os-su-link" to="/auth/sign-in">
            Already have an account? Sign in
          </Link>
          {status && <p className="os-auth-status">{status}</p>}
        </div>
      </form>
      <style>{`.os-su-fields{display:flex;flex-direction:column;gap:12px;margin-top:4px}
        .os-su-link{text-align:center;font-size:13px;font-weight:500}`}</style>
    </OSAuthShell>
  );
};

export default SignUpPage;
