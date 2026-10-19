import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { isAuthenticated, token } = useAuthStore();

  // Check both store state and localStorage token
  if (!isAuthenticated && !token) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function AdminGuard({ children }: AuthGuardProps) {
  const user = useAuthStore((s) => s.user);

  if (user && user.role !== "admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
