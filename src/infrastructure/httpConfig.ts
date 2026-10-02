/**
 * Where an infrastructure client sends its requests: this site's own relay
 * routes on the web (an empty base URL, same origin), an absolute URL with a
 * header naming the client on mobile. Each app passes one when it builds a
 * client; it is configuration, not a platform port.
 */
export type HttpConfig = {
  baseUrl: string;
  headers(): Record<string, string>;
};
