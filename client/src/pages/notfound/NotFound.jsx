import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="text-center py-16">
      <div className="text-3xl font-bold">404</div>
      <div className="text-gray-400 mt-2">Page not found</div>
      <Link className="inline-block mt-6 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700" to="/dashboard">
        Go dashboard
      </Link>
    </div>
  );
}
