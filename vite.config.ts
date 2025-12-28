import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/// <reference types="vitest" />

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "mock-api",
      configureServer(server) {
        let users = [
          { id: 1, name: "Alice", email: "alice@example.com", role: "Admin" },
          { id: 2, name: "Bob", email: "bob@example.com", role: "User" },
          { id: 999, name: "Error User", email: "error@example.com", role: "User" },
        ];

        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/users")) {
            next();
            return;
          }

          await new Promise((resolve) => setTimeout(resolve, 1500));

          const sendJson = (data: any, status = 200) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(data));
          };

          const sendProblem = (status: number, title: string, detail: string) => {
            res.statusCode = status;
            res.setHeader("Content-Type", "application/problem+json");
            res.end(
              JSON.stringify({
                type: "https://example.com/probs/" + status,
                title,
                status,
                detail,
                instance: req.url,
              })
            );
          };

          // Handle List
          if (req.url === "/api/users" || req.url === "/api/users/") {
            if (req.method === "POST") {
              let body = "";
              req.on("data", (chunk) => {
                body += chunk;
              });
              req.on("end", () => {
                try {
                  const newUser = JSON.parse(body);
                  const id = Math.max(...users.map((u) => u.id), 0) + 1;
                  const createdUser = { id, ...newUser };
                  users.push(createdUser);
                  sendJson(createdUser, 201);
                } catch (e) {
                  sendProblem(400, "Bad Request", "Invalid JSON body");
                }
              });
              return;
            }

            if (req.method === "GET") {
              sendJson(users.map(({ id, name }) => ({ id, name })));
              return;
            }
          }

          const match = req.url.match(/\/api\/users\/(\d+)/);
          if (match) {
            const id = parseInt(match[1]);
            const userIndex = users.findIndex((u) => u.id === id);

            if (req.method === "GET") {
              if (userIndex !== -1) {
                if (id === 999) {
                   // Simulate error for specific ID if needed, or just return the user
                   // For now, let's keep the error simulation if that was the intent,
                   // but the task was just to add POST. 
                   // Let's keep the "999" behavior as "Not Found" simulation for consistency with previous code if desired, 
                   // OR just return the user. The previous code returned 404 for 999.
                   sendProblem(404, "User Not Found", `User with ID ${id} does not exist in our database.`);
                   return;
                }
                sendJson(users[userIndex]);
              } else {
                sendProblem(404, "Not Found", "The requested resource could not be found.");
              }
              return;
            }

            if (req.method === "DELETE") {
              if (userIndex !== -1) {
                 users.splice(userIndex, 1);
                 sendJson({ success: true }); // Or 204 No Content
              } else {
                 sendProblem(404, "Not Found", "The requested resource could not be found.");
              }
              return;
            }
          }

          // Fallback
          sendProblem(404, "Not Found", "The requested resource could not be found.");
        });
      },
    },
  ],
  test: {
    environment: "happy-dom",
  },
});
