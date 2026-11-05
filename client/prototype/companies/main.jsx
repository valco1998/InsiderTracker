// PROTOTYPE entry — served only by `vite` dev at /prototype/companies/ (not in the production build).
import React from "react";
import ReactDOM from "react-dom/client";
import "../../src/pages/insider/insider.css";
import "./prototype.css";
import CompaniesPrototype from "./CompaniesPrototype";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CompaniesPrototype />
  </React.StrictMode>
);
