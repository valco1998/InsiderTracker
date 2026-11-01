import { Navigate } from "react-router-dom";
import useAuth from "../../hooks/useAuth";
import Loader from "./Loader";

export default function ProtectedRoute({ children }) {
  const { isAuthed, loading } = useAuth();
  if (loading) return <Loader />;
  if (!isAuthed) return <Navigate to="/login" replace />;
  return children;
}
