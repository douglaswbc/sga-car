import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // `output: "standalone"` foi removido: esse modo existe para o container Docker
  // com Caddy que a plataforma abandonou. O OpenNext gera o bundle do Worker.
  poweredByHeader: false,
};

export default nextConfig;

// Habilita as bindings da Cloudflare durante `next dev` e `opennextjs-cloudflare preview`.
initOpenNextCloudflareForDev();
