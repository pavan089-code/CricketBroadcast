import { defineConfig } from 'vite';
import { handleResolve } from './worker/src/resolve';
import { handleCricClubs } from './worker/src/cricclubs';

export default defineConfig({
    base: './',
    build: { outDir: 'dist' },
    plugins: [{
        name: 'cricclubs-local-proxy',
        configureServer(server) {
            // Development and production share routing, tokens and error handling.
            for (const route of ['resolve', 'match']) {
                server.middlewares.use(`/api/cricclubs/${route}`, async (request, response) => {
                    const input = new Request(new URL(request.url || '/', 'http://localhost'), { method: request.method });
                    const result = route === 'resolve' ? await handleResolve(input)
                        : await handleCricClubs(input, process.env.CRICCLUBS_DIAGNOSTICS === 'true');
                    response.writeHead(result.status, Object.fromEntries(result.headers));
                    response.end(await result.text());
                });
            }
        },
    }],
});
