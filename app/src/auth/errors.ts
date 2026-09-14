/**
 * GoTrue in French.
 *
 * Supabase answers in English, and its sentences are written for the developer who called the
 * API rather than for the person in front of the screen: "Signups not allowed for otp" is what
 * somebody who has simply never been invited receives, and left as it stands it reads like a bug
 * in the tool rather than like an answer.
 *
 * Kept apart from the components because it is the one part of the login that can be tested
 * without a browser and without a network, and because both doors, the password and the link,
 * as well as the password change, run their failures through it.
 *
 * The fallback keeps the original sentence rather than replacing it with a generic apology. The
 * messages that reach it are the rare ones, they name something real, and the person reading
 * them is the one who can act on them or forward them.
 */

export function frenchAuthError(message: string): string {
  const text = message.trim();

  // The everyday one, and the only one most régisseurs will ever see. GoTrue deliberately does
  // not say which of the two was wrong, and neither do we: saying "unknown address" would tell
  // anybody who asks whether a given person is an organiser here.
  if (/invalid login credentials|invalid credentials/i.test(text)) {
    return 'Adresse email ou mot de passe incorrect.';
  }

  if (/signups not allowed|not allowed for otp/i.test(text)) {
    return "Cette adresse n'a pas encore été invitée. Demandez au régisseur de vous ajouter.";
  }

  if (/rate limit|only request this after|too many/i.test(text)) {
    return 'Trop de demandes de suite. Attendez une minute avant de réessayer.';
  }

  // Said by the password change, when the account was invited but the address never confirmed.
  if (/email not confirmed/i.test(text)) {
    return "Cette adresse n'a jamais été confirmée. Passez par le lien envoyé par email une première fois.";
  }

  if (/password should be at least (\d+)/i.test(text)) {
    const least = /password should be at least (\d+)/i.exec(text)?.[1] ?? '8';
    return `Le mot de passe doit faire au moins ${least} caractères.`;
  }

  if (/new password should be different/i.test(text)) {
    return "Le nouveau mot de passe doit être différent de l'ancien.";
  }

  // The session died between opening the screen and submitting it. Nothing was changed.
  if (/auth session missing|session_not_found|jwt expired|invalid refresh token/i.test(text)) {
    return 'Votre session a expiré. Rechargez la page et reconnectez-vous.';
  }

  if (/reauthentication/i.test(text)) {
    return 'Le changement de mot de passe demande une reconnexion. Déconnectez-vous, puis revenez par le lien envoyé par email.';
  }

  if (/invalid|malformed/i.test(text)) return "Cette adresse email n'est pas valide.";

  if (/failed to fetch|networkerror|load failed/i.test(text)) {
    return 'Le serveur est injoignable. Vérifiez votre connexion, puis réessayez.';
  }

  return `La connexion a échoué: ${text}`;
}

/** The rule the login form states before the server gets a chance to refuse. */
export const MIN_PASSWORD = 8;

/**
 * What is wrong with a password the régisseur is choosing, or null when nothing is.
 *
 * Checked here rather than left to the server so the answer is instant and so the two fields
 * can be compared at all: a typo repeated identically is the one mistake that locks somebody
 * out of an account they have just created, and only the browser ever sees both fields.
 */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
  }
  if (password !== again) return 'Les deux mots de passe ne sont pas identiques.';
  return null;
}
