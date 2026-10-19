/**
 * Alpine Cloud does not exist yet (docs/alpine-cloud.md, build order stage 3). Until it does, these screens run
 * against this stand-in, so they can be seen and tried in Storybook. Nothing here talks to a server.
 */

export type SignInMethod = 'google' | 'github' | 'email';

export interface AlpineAccount {
  name: string;
  email: string;
  credits: number;
}

export interface AlpineSignInApi {
  /** Opens the browser for Google or GitHub and resolves when the sign-in comes back. */
  browser: (method: Exclude<SignInMethod, 'email'>) => Promise<AlpineAccount>;
  sendCode: (email: string) => Promise<void>;
  /** Rejects when the code does not match. */
  verify: (email: string, code: string) => Promise<AlpineAccount>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const PREVIEW_ACCOUNT: AlpineAccount = { name: '하늘', email: 'haneul@example.com', credits: 300 };

export const previewSignIn: AlpineSignInApi = {
  browser: async () => {
    await wait(2200);
    return PREVIEW_ACCOUNT;
  },
  sendCode: async () => {
    await wait(700);
  },
  verify: async (email, code) => {
    await wait(600);
    if (code === '000000') throw new Error('wrong code');
    return { ...PREVIEW_ACCOUNT, email };
  },
};

/** Where user apps live until the domain is bought (decision 4). A placeholder, not a real address. */
export const APP_DOMAIN = 'alpine.page';

export const appAddress = (name: string) => `${name}.${APP_DOMAIN}`;
