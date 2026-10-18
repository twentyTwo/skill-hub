export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Returns a GitHub token. With `interactive`, may ask the user to sign in, explaining `reason` if given. */
export type TokenProvider = (interactive: boolean, reason?: string) => Promise<string | undefined>;

export interface RequestOptions {
  /** Send GitHub credentials if the user is already signed in. */
  github?: boolean;
  /** If an anonymous request is refused (private repo, rate limit), offer to sign in and retry once. */
  promptForAuth?: boolean;
  /** Why sign-in is needed, shown in the sign-in prompt. */
  authReason?: string;
  accept?: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const USER_AGENT = 'skill-hub-vscode';
const TIMEOUT_MS = 30_000;
const AUTH_STATUSES = new Set([401, 403, 404, 429]);

export class Http {
  /** Token from an interactive sign-in, reused for the requests that follow it. */
  private signedIn?: string;

  constructor(private readonly options: { fetch?: FetchFn; githubToken?: TokenProvider } = {}) {}

  async request(url: string, opts: RequestOptions = {}): Promise<Response> {
    const fetchFn = this.options.fetch ?? fetch;
    const send = (token: string | undefined) => {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
      if (opts.accept) headers.Accept = opts.accept;
      if (token) headers.Authorization = `Bearer ${token}`;
      return fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    };

    let token = opts.github ? await this.token(false) : undefined;
    let res = await send(token);
    if (!res.ok && opts.github && opts.promptForAuth && !token && AUTH_STATUSES.has(res.status)) {
      token = this.signedIn = await this.token(true, opts.authReason);
      if (token) res = await send(token);
    }
    if (res.status === 401 && token === this.signedIn) this.signedIn = undefined;
    if (!res.ok) throw new HttpError(res.status, url, failureMessage(res, url, !!token));
    return res;
  }

  async json<T>(url: string, opts?: RequestOptions): Promise<T> {
    return (await this.request(url, opts)).json() as Promise<T>;
  }

  async text(url: string, opts?: RequestOptions): Promise<string> {
    return (await this.request(url, opts)).text();
  }

  async bytes(url: string, opts?: RequestOptions): Promise<Uint8Array> {
    return new Uint8Array(await (await this.request(url, opts)).arrayBuffer());
  }

  private async token(interactive: boolean, reason?: string): Promise<string | undefined> {
    if (!interactive && this.signedIn) return this.signedIn;
    try {
      return await this.options.githubToken?.(interactive, reason);
    } catch {
      return undefined;
    }
  }
}

function failureMessage(res: Response, url: string, authenticated: boolean): string {
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    return authenticated
      ? 'GitHub API rate limit reached. Try again later.'
      : 'GitHub API rate limit reached. Sign in to GitHub (Accounts menu) to raise the limit.';
  }
  if (res.status === 404) return `Not found: ${url}${authenticated ? '' : ' (if it is private, sign in to GitHub)'}`;
  return `Request failed (${res.status} ${res.statusText}): ${url}`;
}
