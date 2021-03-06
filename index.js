#!/usr/bin/env node
const fs = require("fs");
const mkdirp = require("mkdirp");
const yargs = require("yargs");
const { Certificate } = require("@govtechsg/open-certificate");

const batchIssue = require("./src/batchIssue");
const CertificateStore = require("./src/contract/certificateStore.js");
const { logger, addConsole } = require("./lib/logger");
const {
  generateRandomCertificate
} = require("./src/randomCertificateGenerator");

// Pass argv with $1 and $2 sliced
const parseArguments = argv =>
  yargs
    .version("0.1.0")
    .usage("Certificate issuing, verification and revocation tool.")
    .strict()
    .epilogue(
      "The common subcommands you might be interested in are:\n" +
        "- issue\n" +
        "- verify\n" +
        "- revoke"
    )
    .options({
      "log-level": {
        choices: ["error", "warn", "info", "verbose", "debug", "silly"],
        default: "info",
        description: "Set the log level",
        global: true
      }
    })
    .command({
      command: "verify [options] <file>",
      description: "Verify the certificate",
      builder: sub =>
        sub.positional("file", {
          description: "Certificate file to verify",
          normalize: true
        })
    })
    .command({
      command: "generate [options] <dir>",
      description: "Generate random certificates",
      builder: sub =>
        sub
          .positional("dir", {
            description: "The directory to generate the random certificates to",
            normalize: true
          })
          .options({
            count: {
              default: 10,
              number: true,
              description: "The number of certificates to generate",
              coerce: parseInt
            }
          })
          .option({
            "contract-address": {
              default: "0x0",
              description: "Address of the certificate store contract",
              string: true
            }
          })
    })
    .command({
      command:
        "filter <inputCertificatePath> <outputCertificatePath> [filters...]",
      description:
        "Hide selected evidences on certificate. " +
        "Example of filters: transcript.0.grade",
      builder: sub =>
        sub
          .positional("inputCertificatePath", {
            description: "The certificate file to read from",
            normalize: true
          })
          .positional("outputCertificatePath", {
            description: "The filtered certificate file to write to",
            normalize: true
          })
          .options({
            filters: {
              type: "array",
              description: "The number of certificates to generate"
            }
          })
    })
    .command({
      command: "deploy <address> <name>",
      description:
        "Deploy a certificate store for issuer at " +
        "address` with name `name`.",
      builder: sub =>
        sub
          .positional("address", {
            description: "Account address of the issuer"
          })
          .positional("name", { description: "Name of the issuer" })
    })
    .command({
      command: "transfer <originalOwner> <newOwner> <contractAddress>",
      description:
        "Transfer ownership of certificate store at `contractAddress` from " +
        "`originalOwner` to `newOwner`",
      builder: sub =>
        sub
          .positional("originalOwner", {
            description: "Original owner of the certificate store contract"
          })
          .positional("newOwner", {
            description:
              "New owner to transfer the certificate store contract to"
          })
          .positional("contactAddress", {
            description: "Address of contract to transfer ownership."
          })
    })
    .command({
      command: "batch [options] <raw-dir> <batched-dir>",
      description:
        "Combine a directory of certificates into a certificate batch",
      builder: sub =>
        sub
          .positional("raw-dir", {
            description:
              "Directory containing the raw unissued and unsigned certificates",
            normalize: true
          })
          .positional("batched-dir", {
            description: "Directory to output the batched certificates to.",
            normalize: true
          })
    })
    .command({
      command: "commit <merkleRoot> <issuerAddress> <storeAddress>",
      description:
        "Commit a certificate batch Merkle root to a certificate store",
      builder: sub =>
        sub
          .positional("merkleRoot", {
            description: "Merkle root of the certificate batch."
          })
          .positional("issuerAddress", { description: "Address of the issuer" })
          .positional("storeAddress", {
            description: "Address of the certificate store contract"
          })
    })
    .command({
      command: "revoke <certificateHash> <issuerAddress> <storeAddress>",
      description:
        "Revoke a certificate batch Merkle root to a certificate store",
      builder: sub =>
        sub
          .positional("certificateHash", {
            description: "Hash of the certificate to revoke."
          })
          .positional("issuerAddress", { description: "Address of the issuer" })
          .positional("storeAddress", {
            description: "Address of the certificate store contract"
          })
    })
    .parse(argv);

const generate = (dir, count, contractAddress) => {
  mkdirp.sync(dir);
  const generated = generateRandomCertificate(count, dir, contractAddress);
  logger.info(`Generated ${generated} certificates.`);
  return count;
};

const filter = (inputPath, outputPath, filters) => {
  const certificateJson = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const cert = new Certificate(certificateJson);
  const newCertificate = cert.privacyFilter(filters);
  const filteredCert = JSON.stringify(newCertificate.getCertificate(), null, 2);

  fs.writeFileSync(outputPath, filteredCert);

  return filteredCert;
};

const batch = async (raw, batched) => {
  mkdirp.sync(batched);
  return batchIssue(raw, batched).then(merkleRoot => {
    logger.info(`Batch Certificate Root: ${merkleRoot}`);
    return `${merkleRoot}`;
  });
};

const verify = file => {
  const certificateJson = JSON.parse(fs.readFileSync(file, "utf8"));
  const certificate = new Certificate(certificateJson);

  certificate.verify();
  logger.info("Certificate's signature is valid!");
  logger.warn(
    "Warning: Please verify this certificate on the blockchain with the issuer's certificate store."
  );

  return true;
};

const deploy = async (address, name) => {
  const store = new CertificateStore(address);
  return store.deployStore(name).then(deployedAddress => {
    logger.info(`Contract deployed at ${deployedAddress}.`);
    return deployedAddress;
  });
};

const transfer = async (originalOwner, newOwner, contractAddress) => {
  const store = new CertificateStore(originalOwner, contractAddress);

  return store.transferOwnership(newOwner).then(tx => {
    logger.info(
      `Contract at ${contractAddress} transfered from ${originalOwner} ` +
        `to ${newOwner}`
    );
    logger.debug(JSON.stringify(tx));
    return tx.transactionHash;
  });
};

const commit = async (merkleRoot, issuerAddress, storeAddress) => {
  const store = new CertificateStore(issuerAddress, storeAddress);

  return store.issueCertificate(merkleRoot).then(tx => {
    logger.info(
      `Certificate batch issued: ${merkleRoot}\n` +
        `by ${issuerAddress} at certificate store ${storeAddress}\n`
    );
    logger.debug(JSON.stringify(tx));
    return tx.transactionHash;
  });
};

const revoke = async (certificateHash, issuerAddress, storeAddress) => {
  const store = new CertificateStore(issuerAddress, storeAddress);

  return store.revokeCertificate(certificateHash).then(tx => {
    logger.info(
      `Certificate revoked: ${certificateHash}\n` +
        `by ${issuerAddress} at certificate store ${storeAddress}\n`
    );
    logger.debug(JSON.stringify(tx));
    return tx.transactionHash;
  });
};

const main = async argv => {
  const args = parseArguments(argv);
  addConsole(args.logLevel);
  logger.debug(`Parsed args: ${JSON.stringify(args)}`);

  if (args._.length !== 1) {
    yargs.showHelp("log");
    return false;
  }
  switch (args._[0]) {
    case "generate":
      return generate(args.dir, args.count, args.contractAddress);
    case "batch":
      return batch(args.rawDir, args.batchedDir);
    case "filter":
      return filter(
        args.inputCertificatePath,
        args.outputCertificatePath,
        args.filters
      );
    case "verify":
      return verify(args.file);
    case "deploy":
      return deploy(args.address, args.name);
    case "transfer":
      return transfer(args.originalOwner, args.newOwner, args.contractAddress);
    case "commit":
      return commit(args.merkleRoot, args.issuerAddress, args.storeAddress);
    case "revoke":
      return revoke(
        args.certificateHash,
        args.issuerAddress,
        args.storeAddress
      );
    default:
      throw new Error(`Unknown command ${args._[0]}. Possible bug.`);
  }
};

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv.slice(2))
    .then(value => {
      console.log(value); // eslint-disable-line no-console
      process.exit(0);
    })
    .catch(err => {
      logger.error(`Error executing: ${err}`);
      if (typeof err.stack !== "undefined") {
        logger.debug(err.stack);
      }
      logger.debug(JSON.stringify(err));
      process.exit(1);
    });
}
