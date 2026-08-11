import { SignIn } from "@clerk/react";

function LoginPage() {
  return (
    <div className="h-screen hero">
      <SignIn />
    </div>
  );
}

export default LoginPage;