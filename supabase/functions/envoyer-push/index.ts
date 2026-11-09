// La Wave — envoi des notifications push en attente (voir sql/push.sql).
// Copie de référence de la fonction déployée dans Supabase (« envoyer-push », sans JWT : elle vérifie un secret partagé).
// Appelée chaque minute par la base (push_declencher) ; elle lit push_config avec la clé de service.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: cfg } = await sb.from("push_config").select("*").eq("id", 1).single();
  if (!cfg || req.headers.get("x-push-secret") !== cfg.secret) {
    return new Response("non", { status: 401 });
  }

  webpush.setVapidDetails("mailto:" + cfg.contact, cfg.cle_publique, cfg.cle_privee);

  const { data: file } = await sb
    .from("push_file")
    .select("*")
    .is("envoye_le", null)
    .gt("cree_le", new Date(Date.now() - 86400000).toISOString())
    .order("cree_le")
    .limit(100);

  let envoyes = 0;
  let morts = 0;

  for (const m of file ?? []) {
    const { data: abos } = await sb.from("push_abonnements").select("*").eq("user_id", m.user_id);
    const charge = JSON.stringify({ titre: m.titre, corps: m.corps, url: m.url });

    for (const a of abos ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          charge,
          { TTL: 3600 },
        );
        envoyes++;
      } catch (e) {
        // Un abonnement résilié ou expiré : on le retire.
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await sb.from("push_abonnements").delete().eq("id", a.id);
          morts++;
        }
      }
    }

    await sb.from("push_file").update({ envoye_le: new Date().toISOString() }).eq("id", m.id);
  }

  // Le ménage : les messages de plus d'une semaine s'effacent.
  await sb.from("push_file").delete().lt("cree_le", new Date(Date.now() - 7 * 86400000).toISOString());

  return new Response(JSON.stringify({ envoyes, morts, traites: (file ?? []).length }), {
    headers: { "Content-Type": "application/json" },
  });
});
