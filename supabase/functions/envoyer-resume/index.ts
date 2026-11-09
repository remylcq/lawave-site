// La Wave — envoi du résumé hebdomadaire par e-mail (voir sql/email-resume.sql).
// Copie de référence de la fonction déployée dans Supabase (« envoyer-resume », sans JWT : elle vérifie un secret partagé).
// Appelée chaque lundi par la base. Sans clé d'envoi (email_config.cle_api), elle ne fait rien.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = "https://lawave.fr";

const h = (t: unknown) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function page(c: any, jeton: string): string {
  const sorties = (c.sorties ?? []).map((s: any) => `
    <tr><td style="padding:8px 0">
      <a href="${SITE}/partage.php?s=${s.num}" style="color:#111;text-decoration:none;display:flex;align-items:center">
        ${s.cover ? `<img src="${h(s.cover)}" width="56" height="56" style="border-radius:8px;margin-right:12px" alt="">` : ""}
        <span><b>${h(s.titre)}</b><br><span style="color:#666">${h(s.artiste)}</span></span>
      </a></td></tr>`).join("");

  const posts = (c.posts ?? []).map((p: any) => `
    <p style="margin:0 0 10px;color:#333">« ${h(p.extrait)} » <span style="color:#888">— @${h(p.auteur)}</span></p>`).join("");

  const defi = c.defi
    ? `<h3 style="margin:24px 0 6px">Le défi de la semaine</h3><p style="margin:0;color:#333"><b>${h(c.defi.titre)}</b><br>${h(c.defi.consigne)}</p>`
    : "";

  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f5f6;font:15px/1.5 -apple-system,Segoe UI,sans-serif">
  <div style="max-width:540px;margin:0 auto;padding:28px 20px">
    <h2 style="margin:0 0 4px">Ta semaine sur La Wave</h2>
    <p style="margin:0 0 20px;color:#666">Bonjour ${h(c.pseudo)}, voici ce qui est sorti chez les artistes que tu suis.</p>
    <table style="width:100%;border-collapse:collapse">${sorties}</table>
    ${posts ? `<h3 style="margin:24px 0 6px">Dans la communauté</h3>${posts}` : ""}
    ${defi}
    <p style="margin:28px 0 0;font-size:12px;color:#888">Tu reçois ce résumé parce que tu l'as demandé dans tes réglages.
      <a href="${SITE}/desinscrire.php?j=${h(jeton)}" style="color:#888">Se désinscrire</a></p>
  </div></body></html>`;
}

Deno.serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfg } = await sb.from("email_config").select("*").eq("id", 1).single();
  if (!cfg || req.headers.get("x-resume-secret") !== cfg.secret) return new Response("non", { status: 401 });
  if (!cfg.cle_api) return new Response(JSON.stringify({ envoyes: 0, raison: "pas de clé d'envoi" }), { headers: { "Content-Type": "application/json" } });

  const { data: liste } = await sb.rpc("email_resume_a_envoyer");
  let envoyes = 0;
  let echecs = 0;

  for (const r of (liste ?? []).slice(0, 200)) {
    const rep = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.cle_api}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.expediteur,
        to: [r.email],
        subject: "Ta semaine sur La Wave",
        html: page(r.contenu, r.jeton),
        headers: { "List-Unsubscribe": `<${SITE}/desinscrire.php?j=${r.jeton}>` },
      }),
    });

    if (rep.ok) {
      await sb.from("email_resume").update({ dernier_envoi: new Date().toISOString() }).eq("user_id", r.user_id);
      envoyes++;
    } else {
      echecs++;
    }
  }

  return new Response(JSON.stringify({ envoyes, echecs }), { headers: { "Content-Type": "application/json" } });
});
