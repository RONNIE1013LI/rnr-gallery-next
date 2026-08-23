export function assertProductionDeploymentSource(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (env.VERCEL_ENV !== "production") return;

  if (env.VERCEL_GIT_COMMIT_REF !== "main") {
    throw new Error(
      "Production deployments must originate from the main branch. Use GitHub main and Vercel automatic deployment; direct CLI Production deployment is blocked.",
    );
  }

  if (!/^[a-f0-9]{40}$/i.test(env.VERCEL_GIT_COMMIT_SHA ?? "")) {
    throw new Error(
      "Production deployments require a full Git commit SHA from the Vercel Git integration.",
    );
  }
}

assertProductionDeploymentSource();
