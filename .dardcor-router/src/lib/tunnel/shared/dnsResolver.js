import dns from "dns";

const resolver = new dns.promises.Resolver();
resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

export async function resolveDns(hostname, timeoutMs) {
  const tryResolver = (fn) => Promise.race([
    fn(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("dns timeout")), timeoutMs)),
  ]).then(() => true).catch(() => false);

  if (await tryResolver(() => resolver.resolve4(hostname))) return true;
  return tryResolver(() => dns.promises.resolve4(hostname));
}
