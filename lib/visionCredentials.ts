function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

/**
 * Builds a Google service-account JSON object from split VISION_CREDENTIALS_* env vars.
 */
export function getVisionServiceAccountCredentials(): Record<string, string> {
  const privateKeyRaw = requireEnv("VISION_CREDENTIALS_PRIVATE_KEY");
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  const creds: Record<string, string> = {
    type: requireEnv("VISION_CREDENTIALS_TYPE"),
    project_id: requireEnv("VISION_CREDENTIALS_PROJECT_ID"),
    private_key_id: requireEnv("VISION_CREDENTIALS_PRIVATE_KEY_ID"),
    private_key: privateKey,
    client_email: requireEnv("VISION_CREDENTIALS_CLIENT_EMAIL"),
    client_id: requireEnv("VISION_CREDENTIALS_CLIENT_ID"),
  };

  const universe = process.env.VISION_CREDENTIALS_UNIVERSE_DOMAIN?.trim();
  if (universe) {
    creds.universe_domain = universe;
  }

  return creds;
}
