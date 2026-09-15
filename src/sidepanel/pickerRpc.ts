import {
  isPickerEvent,
  isPickerRpcResponse,
  type PickerEvent,
  type PickerOperation,
  type PickerRequest,
  type PickerRpcValue,
} from "../shared/messaging/picker";
import type {
  ExecutableExtractionRule,
  ExtractionRuleRunResult,
} from "../shared/types/extraction";
import type { ElementExtractionCandidate } from "../shared/types/picker";

interface PendingRequest {
  timer: ReturnType<typeof setTimeout>;
  resolve(value: PickerRpcValue): void;
  reject(error: Error): void;
}

export interface PickerClient {
  request(op: "PICK"): Promise<boolean>;
  request(op: "STOP"): Promise<boolean>;
  request(op: "URL"): Promise<string>;
  request(op: "SELECTION"): Promise<ElementExtractionCandidate>;
  request(
    op: "RUN",
    payload: { rules: ExecutableExtractionRule[] },
  ): Promise<ExtractionRuleRunResult[]>;
  dispose(error?: Error): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createRequest(
  id: string,
  op: PickerOperation,
  payload?: { rules: ExecutableExtractionRule[] },
): PickerRequest {
  switch (op) {
    case "PICK":
      return { id, op: "PICK" };
    case "STOP":
      return { id, op: "STOP" };
    case "URL":
      return { id, op: "URL" };
    case "SELECTION":
      return { id, op: "SELECTION" };
    case "RUN":
      if (!payload) throw new Error("RUN requires extraction rules.");
      return { id, op: "RUN", rules: payload.rules };
  }
}

class BrowserPickerClient implements PickerClient {
  private readonly pending = new Map<string, PendingRequest>();
  private disposed = false;

  constructor(
    private readonly port: browser.runtime.Port,
    private readonly onEvent: (event: PickerEvent) => void,
  ) {
    this.port.onMessage.addListener(this.handleMessage);
    this.port.onDisconnect.addListener(this.handleDisconnect);
  }

  request(op: "PICK"): Promise<boolean>;
  request(op: "STOP"): Promise<boolean>;
  request(op: "URL"): Promise<string>;
  request(op: "SELECTION"): Promise<ElementExtractionCandidate>;
  request(
    op: "RUN",
    payload: { rules: ExecutableExtractionRule[] },
  ): Promise<ExtractionRuleRunResult[]>;
  request(
    op: PickerOperation,
    payload?: { rules: ExecutableExtractionRule[] },
  ): Promise<PickerRpcValue> {
    if (this.disposed) {
      return Promise.reject(new Error("Page connection is closed."));
    }

    const id = crypto.randomUUID();
    let message: PickerRequest;

    try {
      message = createRequest(id, op, payload);
    } catch (error) {
      return Promise.reject(toError(error));
    }

    return new Promise<PickerRpcValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Page did not respond. Reconnect and try again."));
      }, 8000);

      this.pending.set(id, { timer, resolve, reject });

      try {
        this.port.postMessage(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(toError(error));
      }
    });
  }

  dispose(error = new Error("Page connection changed. Try again.")): void {
    if (this.disposed) return;
    this.disposed = true;

    this.port.onMessage.removeListener(this.handleMessage);
    this.port.onDisconnect.removeListener(this.handleDisconnect);

    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private readonly handleMessage = (message: unknown): void => {
    if (isPickerRpcResponse(message)) {
      const request = this.pending.get(message.id);
      if (!request) return;

      clearTimeout(request.timer);
      this.pending.delete(message.id);

      if (message.ok) request.resolve(message.value);
      else request.reject(new Error(message.error));
      return;
    }

    if (isPickerEvent(message)) this.onEvent(message);
  };

  private readonly handleDisconnect = (): void => {
    this.dispose(new Error("Page disconnected. Reconnect and try again."));
  };
}

export function createPickerClient(
  port: browser.runtime.Port,
  onEvent: (event: PickerEvent) => void,
): PickerClient {
  return new BrowserPickerClient(port, onEvent);
}
