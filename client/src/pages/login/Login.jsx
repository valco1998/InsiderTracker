import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import steamLogoImg from "../../assets/Steam_icon_logo.png";
import { STEAM_LOGIN_URL } from "../../lib/config";

export default function Login() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const steamError = searchParams.get("error");
  const signedOut = location.state?.signedOut === true;

  // Persist the page the user tried to open so SteamCallback can redirect there
  useEffect(() => {
    const from = location.state?.from;
    if (from && from !== "/login") {
      sessionStorage.setItem("redirectAfterLogin", from);
    }
  }, [location.state]);

  return (
    <div style={styles.page}>
      {/* Ambient background glows */}
      <div style={styles.glowTop} />
      <div style={styles.glowBottom} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={styles.logoWrap}>
          <span style={styles.logoText}>SKIN</span>
          <span style={styles.logoAccent}>TEL</span>
        </div>

        <p style={styles.tagline}>
          Sign in with Steam to access your inventory,<br />trades and alerts.
        </p>

        {signedOut && (
          <div style={styles.infoBox}>
            You've been signed out. Steam will log you back in automatically if you click below.
          </div>
        )}

        {steamError && (
          <div style={styles.errorBox}>
            Steam login failed — please try again.
          </div>
        )}

        {/* Steam button */}
        <a
          href={STEAM_LOGIN_URL}
          style={styles.steamBtn}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(102,192,244,0.14)";
            e.currentTarget.style.borderColor = "rgba(102,192,244,0.55)";
            e.currentTarget.style.boxShadow = "0 0 32px rgba(102,192,244,0.18), 0 4px 24px rgba(0,0,0,0.5)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(102,192,244,0.07)";
            e.currentTarget.style.borderColor = "rgba(102,192,244,0.28)";
            e.currentTarget.style.boxShadow = "0 2px 16px rgba(0,0,0,0.35)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <img
            src={steamLogoImg}
            alt="Steam"
            style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }}
          />
          Sign in with Steam
        </a>

        <p style={styles.footnote}>
          No account needed — Steam is your identity.
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "radial-gradient(ellipse 80% 60% at 50% 40%, #12052a 0%, #050816 60%, #020510 100%)",
    position: "relative",
    overflow: "hidden",
    padding: "24px 16px",
  },
  glowTop: {
    position: "absolute",
    top: "-120px",
    left: "50%",
    transform: "translateX(-50%)",
    width: 600,
    height: 400,
    background: "radial-gradient(ellipse, rgba(124,58,237,0.22) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  glowBottom: {
    position: "absolute",
    bottom: "-100px",
    left: "50%",
    transform: "translateX(-50%)",
    width: 500,
    height: 300,
    background: "radial-gradient(ellipse, rgba(34,211,238,0.08) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  card: {
    position: "relative",
    width: "100%",
    maxWidth: 420,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 0,
    padding: "clamp(28px,6vw,52px) clamp(20px,5vw,40px) clamp(24px,6vw,44px)",
    borderRadius: 20,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 8px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
    backdropFilter: "blur(12px)",
    textAlign: "center",
  },
  logoWrap: {
    display: "flex",
    alignItems: "baseline",
    gap: 0,
    marginBottom: 20,
    lineHeight: 1,
  },
  logoText: {
    fontSize: 52,
    fontWeight: 900,
    letterSpacing: "0.06em",
    color: "#fff",
    fontFamily: "'Arial Black', 'Helvetica Neue', sans-serif",
  },
  logoAccent: {
    fontSize: 52,
    fontWeight: 900,
    letterSpacing: "0.06em",
    background: "linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #7c3aed 100%)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    backgroundClip: "text",
    fontFamily: "'Arial Black', 'Helvetica Neue', sans-serif",
  },
  tagline: {
    fontSize: 15,
    lineHeight: 1.65,
    color: "rgba(255,255,255,0.5)",
    marginBottom: 36,
    maxWidth: 300,
  },
  infoBox: {
    width: "100%",
    padding: "10px 16px",
    borderRadius: 10,
    background: "rgba(102,192,244,0.07)",
    border: "1px solid rgba(102,192,244,0.22)",
    color: "rgba(102,192,244,0.85)",
    fontSize: 13,
    marginBottom: 20,
  },
  errorBox: {
    width: "100%",
    padding: "10px 16px",
    borderRadius: 10,
    background: "rgba(239,68,68,0.1)",
    border: "1px solid rgba(239,68,68,0.25)",
    color: "#fca5a5",
    fontSize: 13,
    marginBottom: 20,
  },
  steamBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    padding: "16px 24px",
    borderRadius: 12,
    background: "rgba(102,192,244,0.07)",
    border: "1px solid rgba(102,192,244,0.28)",
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "0.02em",
    textDecoration: "none",
    transition: "all 0.18s ease",
    cursor: "pointer",
    boxShadow: "0 2px 16px rgba(0,0,0,0.35)",
  },
  footnote: {
    marginTop: 20,
    fontSize: 12,
    color: "rgba(255,255,255,0.2)",
    letterSpacing: "0.03em",
  },
};
