import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // `output: "standalone"` foi removido: esse modo existe para o container Docker
  // com Caddy que a plataforma abandonou. O OpenNext gera o bundle do Worker.
  poweredByHeader: false,
  // `pg` importa `pg-cloudflare` só no branch que roda em workerd, e o Next rastreia
  // arquivos sem a condição `workerd`: ele copiaria apenas o `package.json` do pacote,
  // sem o `dist/index.js` que o bundle do Worker realmente executa.
  //
  // Listar o pacote aqui é o que ativa `copyWorkerdPackages` no OpenNext, que copia o
  // pacote inteiro para a server function e poda o `exports` para manter só a branch
  // `workerd`. Sem isso o bundle quebra com "Could not resolve pg-cloudflare", e
  // qualquer alternativa (alias, try/catch, marcar external) apenas adia a falha para
  // a runtime como "CloudflareSocket is not a constructor".
  serverExternalPackages: ["pg-cloudflare"],
};

export default nextConfig;

// Habilita as bindings da Cloudflare durante `next dev` e `opennextjs-cloudflare preview`.
initOpenNextCloudflareForDev();
