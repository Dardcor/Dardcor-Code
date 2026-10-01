export const runtime = 'edge';

export async function GET(request) {
  return Response.json({
    token: process.env.DARDCORROUTER_PEER_TOKEN || 'undefined',
    node_env: process.env.NODE_ENV,
  });
}
