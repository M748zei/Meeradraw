export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INSUFFICIENT_CREDITS"
  | "IMAGE_GENERATION_FAILED"
  | "TEXT_GENERATION_FAILED"
  | "PDF_EXPORT_FAILED"
  | "GENERATION_FAILED"
  | "PAYMENT_FAILED"
  | "TIMEOUT"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public code: AppErrorCode,
    message: string,
    public status: number = 400,
    public action?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const ERROR_MESSAGES: Record<
  AppErrorCode,
  { title: string; description: string; action: string }
> = {
  UNAUTHORIZED: {
    title: "Connexion requise",
    description: "Connectez-vous pour continuer.",
    action: "Se connecter",
  },
  FORBIDDEN: {
    title: "Accès refusé",
    description: "Vous n'avez pas accès à cette ressource.",
    action: "Retour",
  },
  NOT_FOUND: {
    title: "Introuvable",
    description: "Nous n'avons pas trouvé ce que vous cherchez.",
    action: "Retour au studio",
  },
  VALIDATION_ERROR: {
    title: "Informations incomplètes",
    description: "Vérifiez les champs et réessayez.",
    action: "Corriger",
  },
  INSUFFICIENT_CREDITS: {
    title: "Crédits insuffisants",
    description: "Il vous manque quelques crédits pour terminer.",
    action: "Acheter des crédits",
  },
  IMAGE_GENERATION_FAILED: {
    title: "Illustration en pause",
    description: "Nous avons rencontré un petit problème. Essayons à nouveau.",
    action: "Réessayer",
  },
  TEXT_GENERATION_FAILED: {
    title: "Histoire en pause",
    description: "Nous avons rencontré un petit problème. Essayons à nouveau.",
    action: "Réessayer",
  },
  PDF_EXPORT_FAILED: {
    title: "Export en pause",
    description: "Le PDF n'a pas pu être préparé. Essayons à nouveau.",
    action: "Réessayer",
  },
  GENERATION_FAILED: {
    title: "Création en pause",
    description: "Nous avons rencontré un petit problème. Essayons à nouveau.",
    action: "Réessayer",
  },
  PAYMENT_FAILED: {
    title: "Paiement non finalisé",
    description: "Le paiement n'a pas abouti. Vous pouvez réessayer en toute sécurité.",
    action: "Réessayer",
  },
  TIMEOUT: {
    title: "Délai dépassé",
    description: "L’opération a pris trop de temps. Réessayez ou continuez avec le brief de secours.",
    action: "Réessayer",
  },
  INTERNAL_ERROR: {
    title: "Petit souci technique",
    description: "Nous avons rencontré un petit problème. Essayons à nouveau.",
    action: "Réessayer",
  },
};

export function apiSuccess<T>(data: T, status = 200) {
  return Response.json({ success: true, data }, { status });
}

export function apiError(error: unknown) {
  if (error instanceof AppError) {
    const meta = ERROR_MESSAGES[error.code];
    return Response.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message || meta.description,
          title: meta.title,
          action: error.action || meta.action,
        },
      },
      { status: error.status }
    );
  }

  console.error(error);
  const meta = ERROR_MESSAGES.INTERNAL_ERROR;
  return Response.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: meta.description,
        title: meta.title,
        action: meta.action,
      },
    },
    { status: 500 }
  );
}
