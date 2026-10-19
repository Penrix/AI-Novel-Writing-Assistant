import { Router, type Request, type Response, type NextFunction } from "express";
import {
  beginChatGPTSignIn, chatGPTAvailableModels, chatGPTConnectionStatus, chatGPTSignOut,
} from "../session";

const router = Router();

// The application can run on a LAN, but account management must remain local-only.
// A malicious remote page must not be able to start a login or disconnect this account.
router.use((req: Request, res: Response, next: NextFunction) => {
  const remote = req.socket.remoteAddress ?? "";
  const origin = req.get("origin");
  let allowedOrigin = true;
  if (origin) {
    try {
      allowedOrigin = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname);
    } catch { allowedOrigin = false; }
  }
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote) || !allowedOrigin) {
    res.status(403).json({ success: false, error: "ChatGPT 账号连接只允许在本机操作。" });
    return;
  }
  next();
});

router.get("/status", async (_req, res, next) => {
  try { res.json({ success: true, data: await chatGPTConnectionStatus() }); }
  catch (error) { next(error); }
});

router.post("/start", async (req, res, next) => {
  try { res.json({ success: true, data: await beginChatGPTSignIn(req.body?.newAccount === true) }); }
  catch (error) { next(error); }
});

router.get("/models", async (_req, res, next) => {
  try { res.json({ success: true, data: await chatGPTAvailableModels() }); }
  catch (error) { next(error); }
});

router.post("/disconnect", async (_req, res, next) => {
  try { res.json({ success: true, data: await chatGPTSignOut() }); }
  catch (error) { next(error); }
});

export default router;
