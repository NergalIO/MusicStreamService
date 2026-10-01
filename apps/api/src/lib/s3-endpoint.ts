export function s3EndpointUrl(host: string, port: number, useSsl: boolean): string {
  const scheme = useSsl ? 'https' : 'http';
  if ((useSsl && port === 443) || (!useSsl && port === 80)) return `${scheme}://${host}`;
  return `${scheme}://${host}:${port}`;
}
