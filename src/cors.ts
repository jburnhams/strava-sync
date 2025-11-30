
export function getCorsHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleOptions(request: Request): Response {
  if (
    request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null
  ) {
    // Handle CORS pre-flight request.
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders(request),
    });
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      status: 204,
      headers: {
        "Allow": "GET, HEAD, POST, OPTIONS",
      },
    });
  }
}

export function wrapCors(response: Response, request: Request): Response {
  const newHeaders = new Headers(response.headers);
  const corsHeaders = getCorsHeaders(request);
  for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value as string);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
