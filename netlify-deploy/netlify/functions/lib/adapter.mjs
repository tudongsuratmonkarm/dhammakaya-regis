/** Adapts the app's legacy event-style handlers to Netlify's Fetch API runtime. */
export function netlify(handler) {
  return async request => {
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers.entries());
    const event = {
      httpMethod: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? '' : await request.text(),
      queryStringParameters: Object.fromEntries(url.searchParams.entries())
    };
    const result = await handler(event);
    return new Response(result.body || '', { status: result.statusCode || 200, headers: result.headers || {} });
  };
}
