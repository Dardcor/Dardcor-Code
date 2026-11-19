const path = require("path");
const fs = require("fs");
const { MITM_DIR } = require("../paths");
const { generateRootCA, loadRootCA, generateLeafCert } = require("./rootCA");

function generateCert() {
  return generateRootCA();
}

function getCertForDomain(domain) {
  try {
    const rootCA = loadRootCA();
    const leafCert = generateLeafCert(domain, rootCA);
    return {
      key: leafCert.key,
      cert: leafCert.cert
    };
  } catch (error) {
    console.error(`Failed to generate cert for ${domain}:`, error.message);
    return null;
  }
}

module.exports = { generateCert, getCertForDomain };
