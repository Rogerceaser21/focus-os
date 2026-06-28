import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Check, X } from "lucide-react";

type Result = { ok: boolean; title: string; message: string };

export default function SharedAction() {
  const [params] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const token = params.get("token");
    const action = params.get("action");
    if (!token || !action) {
      setResult({ ok: false, title: "Invalid link", message: "This link is missing information or is not valid." });
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const fn = action === "complete" ? "focusos-complete-shared-task" : "focusos-shared-item-action";
        const body = action === "complete" ? { token } : { token, action };
        const { data, error } = await supabase.functions.invoke(fn, { body });
        if (error) throw error;
        setResult(data as Result);
      } catch (e: any) {
        setResult({ ok: false, title: "Something went wrong", message: "Please try again later." });
      } finally {
        setLoading(false);
      }
    })();
  }, [params]);

  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ maxWidth: 480, width: "100%", background: "#FBF7F1", border: "1px solid #E7DCCB", borderRadius: 16, padding: 32, textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, marginBottom: 18 }}>
          <img src="https://focusos.tech/brand/focusos-email-logo.png" width={28} height={28} alt="" />
          <span style={{ fontSize: 16, fontWeight: 600, color: "#292119" }}>Focus<span style={{ color: "#B8572E" }}> OS</span></span>
        </div>
        {loading ? (
          <p style={{ color: "#6E6256", fontSize: 14 }}>Working on it…</p>
        ) : result ? (
          <>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: result.ok ? "#67883A" : "#B8572E", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              {result.ok ? <Check size={28} /> : <X size={28} />}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: "#292119", margin: "0 0 8px" }}>{result.title}</h1>
            <p style={{ fontSize: 14, color: "#6E6256", margin: "0 0 24px", lineHeight: 1.6 }}>{result.message}</p>
            <button
              onClick={() => window.close()}
              style={{ padding: "11px 26px", background: "#B8572E", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer" }}
            >
              Close
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}