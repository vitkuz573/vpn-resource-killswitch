import { getReplManager, type ReplStreamEvent } from "@/lib/repl/manager";
import { replError, requireReplOperator } from "@/lib/repl/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ id: string }>;
};

function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request, { params }: Params) {
  const access = await requireReplOperator();
  if (!access.ok) {
    return access.response;
  }

  const { id } = await params;

  try {
    const manager = getReplManager();
    const snapshot = manager.getPublic(id);
    const backlog = manager.getBacklog(id);

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;

        const send = (event: string, data: unknown) => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
        };

        const unsubscribe = manager.subscribe(id, (event: ReplStreamEvent) => {
          send(event.type, event);
        });

        const heartbeat = setInterval(() => {
          if (closed) {
            return;
          }
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }, 15_000);

        const cleanup = () => {
          if (closed) {
            return;
          }
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // ignore
          }
        };

        request.signal.addEventListener("abort", cleanup);

        send("init", {
          session: snapshot,
          backlog,
        });
      },
      cancel() {
        // no-op, cleanup is handled by abort listener
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return replError(error, "Failed to stream REPL session");
  }
}
