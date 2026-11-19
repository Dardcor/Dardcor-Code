const path = require("path");
const fs = require("fs");
const forge = require("node-forge");
const { MITM_DIR } = require("../paths");

const ROOT_CA_KEY_PATH = path.join(MITM_DIR, "rootCA.key");
const ROOT_CA_CERT_PATH = path.join(MITM_DIR, "rootCA.crt");

function isCertExpired(certPath) {
  try {
    const cert = forge.pki.certificateFromPem(fs.readFileSync(certPath, "utf8"));
    const expiryThreshold = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return cert.validity.notAfter < expiryThreshold;
  } catch {
    return true;
  }
}

function generateRootCA() {
  const exists = fs.existsSync(ROOT_CA_KEY_PATH) && fs.existsSync(ROOT_CA_CERT_PATH);
  if (exists && !isCertExpired(ROOT_CA_CERT_PATH)) {
    console.log("✅ Root CA already exists");
    return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
  }
  if (exists) {
    console.log("🔐 Root CA expired or expiring soon — regenerating...");
    try { fs.unlinkSync(ROOT_CA_KEY_PATH); } catch { }
    try { fs.unlinkSync(ROOT_CA_CERT_PATH); } catch { }
  }

  if (!fs.existsSync(MITM_DIR)) {
    fs.mkdirSync(MITM_DIR, { recursive: true });
  }

  console.log("🔐 Generating Root CA certificate...");

  const keys = forge.pki.rsa.generateKeyPair(2048);

  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: "commonName", value: "Dardcor Router MITM Root CA" },
    { name: "organizationName", value: "Dardcor Router" },
    { name: "countryName", value: "US" }
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: true,
      critical: true
    },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      critical: true
    },
    {
      name: "subjectKeyIdentifier"
    }
  ]);

  cert.sign(keys.privateKey, forge.md.sha256.create());

  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  fs.writeFileSync(ROOT_CA_KEY_PATH, privateKeyPem);
  fs.writeFileSync(ROOT_CA_CERT_PATH, certPem);

  console.log("✅ Root CA generated successfully");
  return { key: ROOT_CA_KEY_PATH, cert: ROOT_CA_CERT_PATH };
}

function loadRootCA() {
  if (!fs.existsSync(ROOT_CA_KEY_PATH) || !fs.existsSync(ROOT_CA_CERT_PATH)) {
    throw new Error("Root CA not found. Generate it first.");
  }

  const keyPem = fs.readFileSync(ROOT_CA_KEY_PATH, "utf8");
  const certPem = fs.readFileSync(ROOT_CA_CERT_PATH, "utf8");

  return {
    key: forge.pki.privateKeyFromPem(keyPem),
    cert: forge.pki.certificateFromPem(certPem)
  };
}

function generateLeafCert(domain, rootCA) {
  const keys = forge.pki.rsa.generateKeyPair(2048);

  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Math.floor(Math.random() * 1000000).toString();
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  cert.setSubject([
    { name: "commonName", value: domain }
  ]);

  cert.setIssuer(rootCA.cert.subject.attributes);

  cert.setExtensions([
    {
      name: "basicConstraints",
      cA: false
    },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: domain },
        { type: 2, value: `*.${domain}` }
      ]
    }
  ]);

  cert.sign(rootCA.key, forge.md.sha256.create());

  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert)
  };
}

module.exports = {
  generateRootCA,
  loadRootCA,
  generateLeafCert,
  isCertExpired,
  ROOT_CA_CERT_PATH,
  ROOT_CA_KEY_PATH
};
