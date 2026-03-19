const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");

const APP_TIMEZONE = "Asia/Shanghai";
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(dataDir, "uploads");
const avatarUploadsDir = path.join(uploadsDir, "avatars");
const blogUploadsDir = path.join(uploadsDir, "blogs");
const storePath = path.join(dataDir, "store.json");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT) || 3000;
const maxJsonBodyBytes = 14 * 1024 * 1024;
const maxAvatarBytes = 4 * 1024 * 1024;
const maxBlogImageBytes = 8 * 1024 * 1024;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

ensureStorage();
migrateLegacyData();

function defaultStore() {
  return {
    users: [],
    sessions: [],
    blogs: [],
    checkinItems: [],
    notifications: [],
    friendRequests: [],
    messages: []
  };
}

function defaultLocation() {
  return {
    countryCode: "",
    countryName: "",
    provinceCode: "",
    provinceName: "",
    cityCode: "",
    cityName: "",
    countyCode: "",
    countyName: ""
  };
}

function defaultProfile() {
  return {
    gender: "",
    bio: "",
    location: defaultLocation()
  };
}

function ensureStorage() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(avatarUploadsDir, { recursive: true });
  fs.mkdirSync(blogUploadsDir, { recursive: true });

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(defaultStore(), null, 2), "utf8");
  }
}

function trimText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  const text = value.trim();
  if (!maxLength) {
    return text;
  }

  return text.slice(0, maxLength);
}

function normalizeName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSecretAnswer(value) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function normalizeBlogVisibility(value) {
  return value === "private" ? "private" : "public";
}

function normalizeCheckinVisibility(value) {
  if (value === "friends" || value === "public") {
    return "friends";
  }

  return "private";
}

function normalizeLocation(location) {
  const source = location && typeof location === "object" ? location : {};

  return {
    countryCode: trimText(source.countryCode, 8).toUpperCase(),
    countryName: trimText(source.countryName, 60),
    provinceCode: trimText(source.provinceCode, 16),
    provinceName: trimText(source.provinceName, 60),
    cityCode: trimText(source.cityCode, 16),
    cityName: trimText(source.cityName, 60),
    countyCode: trimText(source.countyCode, 16),
    countyName: trimText(source.countyName, 60)
  };
}

function normalizeProfile(profile) {
  const source = profile && typeof profile === "object" ? profile : {};

  return {
    gender: trimText(source.gender, 20),
    bio: trimText(source.bio, 240),
    location: normalizeLocation(source.location)
  };
}

function normalizeImageValue(value) {
  const text = trimText(value, 4000000);
  if (!text) {
    return "";
  }

  if (text.startsWith("/uploads/") || text.startsWith("data:image/")) {
    return text;
  }

  return "";
}

function normalizeCompletion(entry) {
  const source = entry && typeof entry === "object" ? entry : {};

  return {
    date: trimText(source.date, 20),
    completedAt: trimText(source.completedAt, 40)
  };
}

function normalizeBlogComment(comment) {
  const source = comment && typeof comment === "object" ? comment : {};

  return {
    id: trimText(source.id, 80),
    userId: trimText(source.userId, 80),
    content: trimText(source.content, 600),
    createdAt: trimText(source.createdAt, 40),
    updatedAt: trimText(source.updatedAt, 40)
  };
}

function normalizeBlog(blog) {
  const source = blog && typeof blog === "object" ? blog : {};
  const likeUserIds = Array.isArray(source.likeUserIds)
    ? source.likeUserIds
        .map((item) => trimText(item, 80))
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
    : [];

  const comments = Array.isArray(source.comments) ? source.comments.map(normalizeBlogComment) : [];
  const imageUrls = Array.isArray(source.imageUrls)
    ? source.imageUrls
        .map(normalizeImageValue)
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
    : [];

  return {
    id: trimText(source.id, 80),
    userId: trimText(source.userId, 80),
    title: trimText(source.title, 80),
    content: typeof source.content === "string" ? source.content.trim().slice(0, 30000) : "",
    visibility: normalizeBlogVisibility(source.visibility),
    createdAt: trimText(source.createdAt, 40),
    updatedAt: trimText(source.updatedAt, 40),
    likeUserIds,
    comments,
    imageUrls
  };
}

function normalizeCheckinItem(item) {
  const source = item && typeof item === "object" ? item : {};
  const completions = Array.isArray(source.completions) ? source.completions.map(normalizeCompletion) : [];
  const deduped = [];
  const seen = new Set();

  completions.forEach((entry) => {
    if (!entry.date || seen.has(entry.date)) {
      return;
    }
    seen.add(entry.date);
    deduped.push(entry);
  });

  deduped.sort((left, right) => String(right.date).localeCompare(String(left.date)));

  return {
    id: trimText(source.id, 80),
    userId: trimText(source.userId, 80),
    title: trimText(source.title, 60),
    frequency: trimText(source.frequency, 40),
    visibility: normalizeCheckinVisibility(source.visibility),
    createdAt: trimText(source.createdAt, 40),
    updatedAt: trimText(source.updatedAt, 40),
    completions: deduped.slice(0, 365)
  };
}

function normalizeNotification(notification) {
  const source = notification && typeof notification === "object" ? notification : {};

  return {
    id: trimText(source.id, 80),
    type: trimText(source.type, 32) || "system",
    toUserId: trimText(source.toUserId, 80),
    fromUserId: trimText(source.fromUserId, 80),
    itemId: trimText(source.itemId, 80),
    blogId: trimText(source.blogId, 80),
    requestId: trimText(source.requestId, 80),
    messageId: trimText(source.messageId, 80),
    message: trimText(source.message, 280),
    createdAt: trimText(source.createdAt, 40),
    readAt: trimText(source.readAt, 40)
  };
}

function normalizeFriendRequest(request) {
  const source = request && typeof request === "object" ? request : {};
  const status = trimText(source.status, 20);

  return {
    id: trimText(source.id, 80),
    fromUserId: trimText(source.fromUserId, 80),
    toUserId: trimText(source.toUserId, 80),
    status: ["pending", "accepted", "rejected"].includes(status) ? status : "pending",
    createdAt: trimText(source.createdAt, 40),
    updatedAt: trimText(source.updatedAt, 40)
  };
}

function normalizeMessage(message) {
  const source = message && typeof message === "object" ? message : {};

  return {
    id: trimText(source.id, 80),
    fromUserId: trimText(source.fromUserId, 80),
    toUserId: trimText(source.toUserId, 80),
    content: trimText(source.content, 2000),
    createdAt: trimText(source.createdAt, 40),
    readAt: trimText(source.readAt, 40)
  };
}

function normalizeUserRecord(user) {
  const source = user && typeof user === "object" ? user : {};

  return {
    id: trimText(source.id, 80),
    name: trimText(source.name, 18),
    avatar: normalizeImageValue(source.avatar),
    createdAt: trimText(source.createdAt, 40),
    passwordHash: trimText(source.passwordHash, 256),
    passwordSalt: trimText(source.passwordSalt, 128),
    securityQuestion: trimText(source.securityQuestion, 60),
    securityAnswerHash: trimText(source.securityAnswerHash, 256),
    securityAnswerSalt: trimText(source.securityAnswerSalt, 128),
    profile: normalizeProfile(source.profile)
  };
}

function normalizeStore(store) {
  const source = store && typeof store === "object" ? store : {};

  return {
    users: Array.isArray(source.users) ? source.users.map(normalizeUserRecord) : [],
    sessions: Array.isArray(source.sessions)
      ? source.sessions
          .map((item) => ({
            token: trimText(item && item.token, 128),
            userId: trimText(item && item.userId, 80),
            createdAt: trimText(item && item.createdAt, 40)
          }))
          .filter((item) => item.token && item.userId)
      : [],
    blogs: Array.isArray(source.blogs) ? source.blogs.map(normalizeBlog) : [],
    checkinItems: Array.isArray(source.checkinItems) ? source.checkinItems.map(normalizeCheckinItem) : [],
    notifications: Array.isArray(source.notifications) ? source.notifications.map(normalizeNotification) : [],
    friendRequests: Array.isArray(source.friendRequests) ? source.friendRequests.map(normalizeFriendRequest) : [],
    messages: Array.isArray(source.messages) ? source.messages.map(normalizeMessage) : []
  };
}

function readStore() {
  ensureStorage();

  try {
    const raw = fs.readFileSync(storePath, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    const fallback = defaultStore();
    fs.writeFileSync(storePath, JSON.stringify(fallback, null, 2), "utf8");
    return normalizeStore(fallback);
  }
}

function writeStore(store) {
  ensureStorage();
  fs.writeFileSync(storePath, JSON.stringify(normalizeStore(store), null, 2), "utf8");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message) {
  sendJson(res, statusCode, { error: message });
}

function sendFile(res, filePath, method, statusCode = 200) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";
    res.writeHead(statusCode, { "Content-Type": contentType });

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(data);
  });
}

function collectRequestBody(req, limitBytes = maxJsonBodyBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

async function parseJsonBody(req) {
  const raw = await collectRequestBody(req);
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("invalid_json");
  }
}

function createId(prefix) {
  return prefix + "-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isValidPassword(password) {
  return /^[A-Za-z0-9]{8,16}$/.test(password) && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(secret, salt, 64).toString("hex");
  return { salt, hash };
}

function timingSafeHexEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function verifySecret(secret, salt, expectedHash) {
  const nextHash = hashSecret(secret, salt).hash;
  return timingSafeHexEqual(nextHash, expectedHash);
}

function getDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(date);
}

function isDataImageUrl(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function parseDataImageUrl(dataUrl) {
  if (!isDataImageUrl(dataUrl)) {
    return null;
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1].toLowerCase(),
    buffer: Buffer.from(match[2], "base64")
  };
}

function getExtensionForMime(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return "";
  }
}

function saveDataImage(dataUrl, kind, prefix) {
  const parsed = parseDataImageUrl(dataUrl);
  if (!parsed) {
    throw new Error("invalid_image");
  }

  const extension = getExtensionForMime(parsed.mimeType);
  if (!extension) {
    throw new Error("invalid_image");
  }

  const sizeLimit = kind === "avatar" ? maxAvatarBytes : maxBlogImageBytes;
  if (parsed.buffer.length > sizeLimit) {
    throw new Error(kind === "avatar" ? "avatar_too_large" : "blog_image_too_large");
  }

  const directory = kind === "avatar" ? avatarUploadsDir : blogUploadsDir;
  const fileName = createId(prefix || kind) + "." + extension;
  const absolutePath = path.join(directory, fileName);
  fs.writeFileSync(absolutePath, parsed.buffer);

  return kind === "avatar" ? "/uploads/avatars/" + fileName : "/uploads/blogs/" + fileName;
}

function isUploadUrl(value) {
  return typeof value === "string" && value.startsWith("/uploads/");
}

function isUploadUrlForKind(value, kind) {
  if (!isUploadUrl(value)) {
    return false;
  }

  return kind === "avatar" ? value.startsWith("/uploads/avatars/") : value.startsWith("/uploads/blogs/");
}

function resolveImageReference(value, kind, prefix) {
  if (value === undefined) {
    return undefined;
  }

  if (isDataImageUrl(value)) {
    return saveDataImage(value, kind, prefix);
  }

  if (isUploadUrlForKind(value, kind)) {
    return value;
  }

  if (!value) {
    return "";
  }

  throw new Error("invalid_image_ref");
}

function uploadUrlToAbsolutePath(urlPath) {
  if (!isUploadUrl(urlPath)) {
    return "";
  }

  const relative = urlPath.replace(/^\/uploads\//, "");
  const absolutePath = path.normalize(path.join(uploadsDir, relative));
  if (!absolutePath.startsWith(uploadsDir)) {
    return "";
  }

  return absolutePath;
}

function removeUploadFile(urlPath) {
  const absolutePath = uploadUrlToAbsolutePath(urlPath);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return;
  }

  try {
    fs.unlinkSync(absolutePath);
  } catch (error) {
    // Ignore missing or locked files during cleanup.
  }
}

function extractUploadUrlsFromMarkdown(markdown) {
  const text = typeof markdown === "string" ? markdown : "";
  const urls = [];
  const pattern = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match = pattern.exec(text);

  while (match) {
    const urlPath = trimText(match[1], 1000);
    if (isUploadUrl(urlPath)) {
      urls.push(urlPath);
    }
    match = pattern.exec(text);
  }

  return urls;
}

function removeUserFiles(user, blogs) {
  if (user && user.avatar) {
    removeUploadFile(user.avatar);
  }

  (blogs || []).forEach((blog) => {
    (blog.imageUrls || []).forEach(removeUploadFile);
    extractUploadUrlsFromMarkdown(blog.content).forEach(removeUploadFile);
  });
}

function migrateLegacyData() {
  const store = readStore();
  let changed = false;

  store.users.forEach((user) => {
    if (isDataImageUrl(user.avatar)) {
      try {
        user.avatar = saveDataImage(user.avatar, "avatar", "legacy-avatar");
        changed = true;
      } catch (error) {
        user.avatar = "";
        changed = true;
      }
    }
  });

  store.blogs.forEach((blog) => {
    if (Array.isArray(blog.imageUrls)) {
      blog.imageUrls = blog.imageUrls
        .map((item) => {
          if (!isDataImageUrl(item)) {
            return item;
          }

          changed = true;
          try {
            return saveDataImage(item, "blog", "legacy-blog");
          } catch (error) {
            return "";
          }
        })
        .filter(Boolean);
    }

    if (isDataImageUrl(blog.content)) {
      blog.content = "";
      changed = true;
    }

    const replaced = String(blog.content || "").replace(/!\[([^\]]*)\]\((data:image\/[^)]+)\)/g, function (_, alt, dataUrl) {
      changed = true;
      try {
        const urlPath = saveDataImage(dataUrl, "blog", "legacy-inline");
        return "![" + alt + "](" + urlPath + ")";
      } catch (error) {
        return alt || "图片";
      }
    });

    if (replaced !== blog.content) {
      blog.content = replaced;
    }
  });

  if (changed) {
    writeStore(store);
  }
}

function getPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    createdAt: user.createdAt,
    profile: normalizeProfile(user.profile)
  };
}

function getUserPreview(user) {
  return user
    ? {
        id: user.id,
        name: user.name,
        avatar: user.avatar
      }
    : null;
}

function findUserById(store, userId) {
  return store.users.find((user) => user.id === userId) || null;
}

function findUserByName(store, name) {
  const normalized = normalizeName(name).toLocaleLowerCase();
  return store.users.find((user) => user.name.toLocaleLowerCase() === normalized) || null;
}

function findBlogById(store, blogId) {
  return store.blogs.find((blog) => blog.id === blogId) || null;
}

function findCheckinItemById(store, itemId) {
  return store.checkinItems.find((item) => item.id === itemId) || null;
}

function findNotificationById(store, notificationId) {
  return store.notifications.find((notification) => notification.id === notificationId) || null;
}

function findFriendRequestById(store, requestId) {
  return store.friendRequests.find((request) => request.id === requestId) || null;
}

function getSessionFromRequest(req, store) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const session = store.sessions.find((item) => item.token === token) || null;
  if (!session) {
    return null;
  }

  const user = findUserById(store, session.userId);
  if (!user) {
    store.sessions = store.sessions.filter((item) => item.token !== token);
    writeStore(store);
    return null;
  }

  return { session, user };
}

function createSession(store, userId) {
  const session = {
    token: createToken(),
    userId,
    createdAt: new Date().toISOString()
  };

  store.sessions.push(session);
  return session;
}

function sortNewestFirst(left, right, field = "createdAt") {
  return String(right[field] || "").localeCompare(String(left[field] || ""));
}

function getTodayCompletion(item) {
  const today = getDateKey();
  return item.completions.find((entry) => entry.date === today) || null;
}

function getAcceptedFriendRequests(store) {
  return store.friendRequests.filter((request) => request.status === "accepted");
}

function getFriendIds(store, userId) {
  const friendIds = new Set();

  getAcceptedFriendRequests(store).forEach((request) => {
    if (request.fromUserId === userId) {
      friendIds.add(request.toUserId);
    } else if (request.toUserId === userId) {
      friendIds.add(request.fromUserId);
    }
  });

  return friendIds;
}

function areFriends(store, leftUserId, rightUserId) {
  if (!leftUserId || !rightUserId || leftUserId === rightUserId) {
    return false;
  }

  const friendIds = getFriendIds(store, leftUserId);
  return friendIds.has(rightUserId);
}

function getFriendshipPayload(store, viewerId, targetUserId) {
  if (!viewerId || !targetUserId) {
    return {
      status: "none",
      requestId: "",
      canChat: false
    };
  }

  if (viewerId === targetUserId) {
    return {
      status: "self",
      requestId: "",
      canChat: false
    };
  }

  if (areFriends(store, viewerId, targetUserId)) {
    return {
      status: "friends",
      requestId: "",
      canChat: true
    };
  }

  const pending = store.friendRequests.find((request) => {
    if (request.status !== "pending") {
      return false;
    }

    const sameDirection = request.fromUserId === viewerId && request.toUserId === targetUserId;
    const reverseDirection = request.fromUserId === targetUserId && request.toUserId === viewerId;
    return sameDirection || reverseDirection;
  });

  if (!pending) {
    return {
      status: "none",
      requestId: "",
      canChat: false
    };
  }

  return {
    status: pending.fromUserId === viewerId ? "outgoing" : "incoming",
    requestId: pending.id,
    canChat: false
  };
}

function canViewBlog(blog, viewerId) {
  return Boolean(blog) && (blog.visibility === "public" || blog.userId === viewerId);
}

function canViewCheckin(item, store, viewerId) {
  if (!item) {
    return false;
  }

  if (item.userId === viewerId) {
    return true;
  }

  return item.visibility === "friends" && areFriends(store, viewerId, item.userId);
}

function getBlogImageUrls(blog) {
  const contentImageUrls = extractUploadUrlsFromMarkdown(blog.content || "");
  const imageUrls = Array.isArray(blog.imageUrls) ? blog.imageUrls : [];
  const merged = [];
  const seen = new Set();

  imageUrls.concat(contentImageUrls).forEach((item) => {
    if (!item || seen.has(item)) {
      return;
    }
    seen.add(item);
    merged.push(item);
  });

  return merged;
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*`~_\-\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeBlog(blog, store, viewerId = "") {
  const author = findUserById(store, blog.userId);
  const likeUserIds = Array.isArray(blog.likeUserIds) ? blog.likeUserIds : [];
  const comments = Array.isArray(blog.comments) ? blog.comments : [];
  const plainText = stripMarkdown(blog.content);

  return {
    id: blog.id,
    userId: blog.userId,
    title: blog.title,
    content: blog.content,
    contentPreview: plainText.slice(0, 220),
    isLong: plainText.length > 220 || String(blog.content || "").length > 420,
    visibility: blog.visibility,
    createdAt: blog.createdAt,
    updatedAt: blog.updatedAt || blog.createdAt,
    likeCount: likeUserIds.length,
    commentCount: comments.length,
    likedByMe: Boolean(viewerId && likeUserIds.includes(viewerId)),
    imageUrls: getBlogImageUrls(blog),
    author: getUserPreview(author)
  };
}

function serializeBlogComment(comment, store) {
  const author = findUserById(store, comment.userId);

  return {
    id: comment.id,
    userId: comment.userId,
    content: comment.content,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt || comment.createdAt,
    author: getUserPreview(author)
  };
}

function serializeBlogDetail(blog, store, viewerId = "") {
  const comments = Array.isArray(blog.comments) ? blog.comments.slice() : [];

  return {
    ...serializeBlog(blog, store, viewerId),
    comments: comments
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
      .map((comment) => serializeBlogComment(comment, store))
  };
}

function serializeCheckinItem(item, store) {
  const owner = findUserById(store, item.userId);
  const todayCompletion = getTodayCompletion(item);

  return {
    id: item.id,
    userId: item.userId,
    title: item.title,
    frequency: item.frequency,
    visibility: item.visibility,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt,
    completedToday: Boolean(todayCompletion),
    completionCount: item.completions.length,
    recentCompletions: item.completions.slice(0, 20),
    owner: getUserPreview(owner)
  };
}

function serializeNotification(notification, store, viewerId) {
  const sender = findUserById(store, notification.fromUserId);
  const item = findCheckinItemById(store, notification.itemId);
  const blog = findBlogById(store, notification.blogId);
  const request = notification.requestId ? findFriendRequestById(store, notification.requestId) : null;

  return {
    id: notification.id,
    type: notification.type,
    message: notification.message,
    createdAt: notification.createdAt,
    readAt: notification.readAt,
    sender: getUserPreview(sender),
    itemId: notification.itemId,
    itemTitle: item ? item.title : "",
    blogId: notification.blogId,
    blogTitle: blog ? blog.title : "",
    requestId: notification.requestId,
    requestStatus: request ? request.status : "",
    canAcceptRequest:
      notification.type === "friend-request" &&
      Boolean(request && request.status === "pending" && request.toUserId === viewerId),
    canOpenChat: notification.type === "chat-message" && Boolean(sender && areFriends(store, viewerId, sender.id))
  };
}

function serializeFriendRequest(request, store, viewerId) {
  const fromUser = findUserById(store, request.fromUserId);
  const toUser = findUserById(store, request.toUserId);

  return {
    id: request.id,
    status: request.status,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt || request.createdAt,
    mine: request.fromUserId === viewerId,
    fromUser: getUserPreview(fromUser),
    toUser: getUserPreview(toUser)
  };
}

function serializeMessage(message, store, viewerId) {
  return {
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
    mine: message.fromUserId === viewerId,
    fromUser: getUserPreview(findUserById(store, message.fromUserId)),
    toUser: getUserPreview(findUserById(store, message.toUserId))
  };
}

function buildConversationList(store, userId) {
  const friendIds = Array.from(getFriendIds(store, userId));

  return friendIds
    .map((friendId) => {
      const friend = findUserById(store, friendId);
      const messages = store.messages
        .filter((message) => {
          const sameForward = message.fromUserId === userId && message.toUserId === friendId;
          const sameBackward = message.fromUserId === friendId && message.toUserId === userId;
          return sameForward || sameBackward;
        })
        .sort(sortNewestFirst);
      const lastMessage = messages[0] || null;
      const unreadCount = messages.filter(
        (message) => message.fromUserId === friendId && message.toUserId === userId && !message.readAt
      ).length;

      return {
        user: getUserPreview(friend),
        unreadCount,
        lastMessage: lastMessage ? serializeMessage(lastMessage, store, userId) : null
      };
    })
    .sort((left, right) => {
      const leftTime = left.lastMessage ? left.lastMessage.createdAt : "";
      const rightTime = right.lastMessage ? right.lastMessage.createdAt : "";
      return String(rightTime).localeCompare(String(leftTime));
    });
}

function buildDashboardPayload(store, userId) {
  const friendIds = getFriendIds(store, userId);

  const mineBlogs = store.blogs
    .filter((blog) => blog.userId === userId)
    .sort(sortNewestFirst)
    .map((blog) => serializeBlog(blog, store, userId));

  const communityBlogs = store.blogs
    .filter((blog) => blog.visibility === "public")
    .sort(sortNewestFirst)
    .map((blog) => serializeBlog(blog, store, userId));

  const mineCheckins = store.checkinItems
    .filter((item) => item.userId === userId)
    .sort(sortNewestFirst)
    .map((item) => serializeCheckinItem(item, store));

  const communityCheckins = store.checkinItems
    .filter((item) => item.visibility === "friends" && item.userId !== userId && friendIds.has(item.userId))
    .sort(sortNewestFirst)
    .map((item) => serializeCheckinItem(item, store));

  const notifications = store.notifications
    .filter((notification) => notification.toUserId === userId)
    .sort(sortNewestFirst)
    .map((notification) => serializeNotification(notification, store, userId));

  const incomingFriendRequests = store.friendRequests
    .filter((request) => request.toUserId === userId && request.status === "pending")
    .sort(sortNewestFirst)
    .map((request) => serializeFriendRequest(request, store, userId));

  const friends = Array.from(friendIds)
    .map((friendId) => findUserById(store, friendId))
    .filter(Boolean)
    .map(getPublicUser)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "zh-CN"));

  return {
    blogs: {
      mine: mineBlogs,
      community: communityBlogs
    },
    checkins: {
      mine: mineCheckins,
      community: communityCheckins
    },
    notifications,
    friendRequests: incomingFriendRequests,
    friends,
    conversations: buildConversationList(store, userId),
    todayKey: getDateKey()
  };
}

function buildUserSpacePayload(store, viewerId, targetUserId) {
  const targetUser = findUserById(store, targetUserId);
  if (!targetUser) {
    return null;
  }

  const isSelf = viewerId === targetUserId;
  const friendship = getFriendshipPayload(store, viewerId, targetUserId);
  const blogs = store.blogs
    .filter((blog) => blog.userId === targetUserId && (isSelf || blog.visibility === "public"))
    .sort(sortNewestFirst)
    .map((blog) => serializeBlog(blog, store, viewerId));

  const checkins = store.checkinItems
    .filter((item) => item.userId === targetUserId && canViewCheckin(item, store, viewerId))
    .sort(sortNewestFirst)
    .map((item) => serializeCheckinItem(item, store));

  return {
    isSelf,
    friendship,
    user: getPublicUser(targetUser),
    blogs,
    checkins
  };
}

function createNotification(store, options) {
  const notification = {
    id: createId("notification"),
    type: trimText(options.type, 32) || "system",
    toUserId: trimText(options.toUserId, 80),
    fromUserId: trimText(options.fromUserId, 80),
    itemId: trimText(options.itemId, 80),
    blogId: trimText(options.blogId, 80),
    requestId: trimText(options.requestId, 80),
    messageId: trimText(options.messageId, 80),
    message: trimText(options.message, 280),
    createdAt: new Date().toISOString(),
    readAt: ""
  };

  if (!notification.toUserId || !notification.message) {
    return null;
  }

  store.notifications.unshift(notification);
  return notification;
}

function markMessagesRead(store, viewerId, friendUserId) {
  const now = new Date().toISOString();
  let changed = false;

  store.messages.forEach((message) => {
    if (message.fromUserId === friendUserId && message.toUserId === viewerId && !message.readAt) {
      message.readAt = now;
      changed = true;
    }
  });

  if (changed) {
    writeStore(store);
  }
}

async function handleApiRequest(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";
  const store = readStore();

  if (pathname === "/api/users" && method === "GET") {
    sendJson(res, 200, {
      users: store.users.slice().sort(sortNewestFirst).map(getPublicUser)
    });
    return;
  }

  if (pathname === "/api/uploads/image" && method === "POST") {
    const body = await parseJsonBody(req);
    const kind = body.kind === "blog" ? "blog" : "avatar";
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";

    if (!dataUrl) {
      sendError(res, 400, "请先选择图片。");
      return;
    }

    try {
      const urlPath = saveDataImage(dataUrl, kind, kind);
      sendJson(res, 201, {
        url: urlPath
      });
    } catch (error) {
      if (error && error.message === "avatar_too_large") {
        sendError(res, 413, "头像图片体积太大，请继续压缩后再试。");
        return;
      }

      if (error && error.message === "blog_image_too_large") {
        sendError(res, 413, "博客图片体积太大，请继续压缩后再试。");
        return;
      }

      sendError(res, 400, "图片格式不正确或上传失败。");
    }
    return;
  }

  if (pathname === "/api/register" && method === "POST") {
    const body = await parseJsonBody(req);
    const name = normalizeName(body.name);
    const password = typeof body.password === "string" ? body.password : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : password;
    const securityQuestion = normalizeName(body.securityQuestion);
    const securityAnswer = typeof body.securityAnswer === "string" ? body.securityAnswer.trim() : "";

    if (!name) {
      sendError(res, 400, "名字不能为空。");
      return;
    }

    if (name.length > 18) {
      sendError(res, 400, "名字需要控制在 18 个字以内。");
      return;
    }

    if (!isValidPassword(password)) {
      sendError(res, 400, "密码需要 8-16 位，只能使用字母和数字，并且必须同时包含两者。");
      return;
    }

    if (password !== confirmPassword) {
      sendError(res, 400, "两次输入的密码不一致。");
      return;
    }

    if (!securityQuestion) {
      sendError(res, 400, "请设置一个密保问题。");
      return;
    }

    if (securityQuestion.length > 60) {
      sendError(res, 400, "密保问题请控制在 60 个字以内。");
      return;
    }

    if (!securityAnswer) {
      sendError(res, 400, "请填写密保答案。");
      return;
    }

    if (securityAnswer.length > 60) {
      sendError(res, 400, "密保答案请控制在 60 个字以内。");
      return;
    }

    if (findUserByName(store, name)) {
      sendError(res, 409, "这个名字已经存在了，换一个更好区分。");
      return;
    }

    let avatar = "";
    try {
      avatar = resolveImageReference(body.avatar, "avatar", "avatar") || "";
    } catch (error) {
      sendError(res, 400, "头像数据无效或体积过大，请重新上传。");
      return;
    }

    if (!avatar) {
      sendError(res, 400, "请先上传头像。");
      return;
    }

    const passwordSecret = hashSecret(password);
    const recoverySecret = hashSecret(normalizeSecretAnswer(securityAnswer));
    const user = {
      id: createId("user"),
      name,
      avatar,
      createdAt: new Date().toISOString(),
      passwordHash: passwordSecret.hash,
      passwordSalt: passwordSecret.salt,
      securityQuestion,
      securityAnswerHash: recoverySecret.hash,
      securityAnswerSalt: recoverySecret.salt,
      profile: defaultProfile()
    };

    store.users.unshift(user);
    const session = createSession(store, user.id);
    writeStore(store);

    sendJson(res, 201, {
      token: session.token,
      user: getPublicUser(user)
    });
    return;
  }

  if (pathname === "/api/login" && method === "POST") {
    const body = await parseJsonBody(req);
    const userId = typeof body.userId === "string" ? body.userId : "";
    const password = typeof body.password === "string" ? body.password : "";
    const user = findUserById(store, userId);

    if (!user || !password) {
      sendError(res, 400, "请先选择用户并输入密码。");
      return;
    }

    if (!verifySecret(password, user.passwordSalt, user.passwordHash)) {
      sendError(res, 401, "密码不对，请重新输入。");
      return;
    }

    const session = createSession(store, user.id);
    writeStore(store);

    sendJson(res, 200, {
      token: session.token,
      user: getPublicUser(user)
    });
    return;
  }

  if (pathname === "/api/session" && method === "GET") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    sendJson(res, 200, {
      user: getPublicUser(auth.user)
    });
    return;
  }

  if (pathname === "/api/dashboard" && method === "GET") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    sendJson(res, 200, buildDashboardPayload(store, auth.user.id));
    return;
  }

  if (pathname === "/api/users/space" && method === "GET") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const userId = url.searchParams.get("userId") || "";
    const payload = buildUserSpacePayload(store, auth.user.id, userId);
    if (!payload) {
      sendError(res, 404, "没有找到这个用户主页。");
      return;
    }

    sendJson(res, 200, payload);
    return;
  }

  if (pathname === "/api/profile" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const gender = normalizeName(body.gender);
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    const location = normalizeLocation(body.location);

    if (!["", "男", "女", "不方便透露"].includes(gender)) {
      sendError(res, 400, "性别选项无效，请重新选择。");
      return;
    }

    if (bio.length > 240) {
      sendError(res, 400, "个人介绍请控制在 240 个字以内。");
      return;
    }

    if (location.countryCode && !location.countryName) {
      sendError(res, 400, "地区信息不完整，请重新选择国家。");
      return;
    }

    let avatar;
    try {
      avatar = resolveImageReference(body.avatar, "avatar", "avatar");
    } catch (error) {
      sendError(res, 400, "头像数据无效或体积过大，请重新上传。");
      return;
    }

    auth.user.profile = {
      gender,
      bio,
      location
    };

    if (avatar !== undefined) {
      const previousAvatar = auth.user.avatar;
      auth.user.avatar = avatar;
      if (previousAvatar && previousAvatar !== avatar) {
        removeUploadFile(previousAvatar);
      }
    }

    writeStore(store);

    sendJson(res, 200, {
      user: getPublicUser(auth.user)
    });
    return;
  }

  if (pathname === "/api/blogs" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const title = trimText(body.title, 80);
    const content = typeof body.content === "string" ? body.content.trim().slice(0, 30000) : "";
    const visibility = normalizeBlogVisibility(body.visibility);
    const imageInputs = Array.isArray(body.imageUrls) ? body.imageUrls : [];

    if (!title) {
      sendError(res, 400, "博客标题不能为空。");
      return;
    }

    const imageUrls = [];
    for (let index = 0; index < Math.min(imageInputs.length, 12); index += 1) {
      try {
        const nextImage = resolveImageReference(imageInputs[index], "blog", "blog");
        if (nextImage) {
          imageUrls.push(nextImage);
        }
      } catch (error) {
        sendError(res, 400, "博客图片无效，请重新上传。");
        return;
      }
    }

    if (!content && !imageUrls.length) {
      sendError(res, 400, "博客内容和图片至少需要填写一项。");
      return;
    }

    const blog = {
      id: createId("blog"),
      userId: auth.user.id,
      title,
      content,
      visibility,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      likeUserIds: [],
      comments: [],
      imageUrls
    };

    store.blogs.unshift(blog);
    writeStore(store);

    sendJson(res, 201, {
      blog: serializeBlog(blog, store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/blogs/detail" && method === "GET") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const blogId = url.searchParams.get("blogId") || "";
    const blog = findBlogById(store, blogId);

    if (!blog || !canViewBlog(blog, auth.user.id)) {
      sendError(res, 404, "没有找到这篇博客。");
      return;
    }

    sendJson(res, 200, {
      blog: serializeBlogDetail(blog, store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/blogs/like" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const blogId = typeof body.blogId === "string" ? body.blogId : "";
    const blog = findBlogById(store, blogId);

    if (!blog || !canViewBlog(blog, auth.user.id)) {
      sendError(res, 404, "没有找到这篇博客。");
      return;
    }

    const likeUserIds = Array.isArray(blog.likeUserIds) ? blog.likeUserIds : [];
    const existingIndex = likeUserIds.indexOf(auth.user.id);
    const likedNow = existingIndex < 0;

    if (existingIndex >= 0) {
      likeUserIds.splice(existingIndex, 1);
    } else {
      likeUserIds.push(auth.user.id);
    }

    blog.likeUserIds = likeUserIds;

    if (likedNow && blog.userId !== auth.user.id) {
      createNotification(store, {
        type: "blog-like",
        toUserId: blog.userId,
        fromUserId: auth.user.id,
        blogId: blog.id,
        message: auth.user.name + " 点赞了你的博客《" + blog.title + "》。"
      });
    }

    writeStore(store);

    sendJson(res, 200, {
      blog: serializeBlogDetail(blog, store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/blogs/comments" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const blogId = typeof body.blogId === "string" ? body.blogId : "";
    const content = trimText(body.content, 600);
    const blog = findBlogById(store, blogId);

    if (!blog || !canViewBlog(blog, auth.user.id)) {
      sendError(res, 404, "没有找到这篇博客。");
      return;
    }

    if (!content) {
      sendError(res, 400, "评论内容不能为空。");
      return;
    }

    const comment = {
      id: createId("comment"),
      userId: auth.user.id,
      content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    blog.comments = Array.isArray(blog.comments) ? blog.comments : [];
    blog.comments.push(comment);

    if (blog.userId !== auth.user.id) {
      createNotification(store, {
        type: "blog-comment",
        toUserId: blog.userId,
        fromUserId: auth.user.id,
        blogId: blog.id,
        message: auth.user.name + " 评论了你的博客《" + blog.title + "》。"
      });
    }

    writeStore(store);

    sendJson(res, 201, {
      blog: serializeBlogDetail(blog, store, auth.user.id),
      comment: serializeBlogComment(comment, store)
    });
    return;
  }

  if (pathname === "/api/blogs/delete" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const blogId = typeof body.blogId === "string" ? body.blogId : "";
    const blog = findBlogById(store, blogId);

    if (!blog || blog.userId !== auth.user.id) {
      sendError(res, 404, "没有找到这篇可删除的博客。");
      return;
    }

    removeUserFiles(null, [blog]);
    store.blogs = store.blogs.filter((item) => item.id !== blog.id);
    store.notifications = store.notifications.filter((notification) => notification.blogId !== blog.id);
    writeStore(store);

    sendJson(res, 200, {
      success: true
    });
    return;
  }

  if (pathname === "/api/checkins/items" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const title = trimText(body.title, 60);
    const frequency = trimText(body.frequency, 40);
    const visibility = normalizeCheckinVisibility(body.visibility);

    if (!title) {
      sendError(res, 400, "打卡项名字不能为空。");
      return;
    }

    if (!frequency) {
      sendError(res, 400, "请填写打卡频率。");
      return;
    }

    const item = {
      id: createId("checkin"),
      userId: auth.user.id,
      title,
      frequency,
      visibility,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completions: []
    };

    store.checkinItems.unshift(item);
    writeStore(store);

    sendJson(res, 201, {
      item: serializeCheckinItem(item, store)
    });
    return;
  }

  if (pathname === "/api/checkins/items/complete" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    const item = findCheckinItemById(store, itemId);

    if (!item || item.userId !== auth.user.id) {
      sendError(res, 404, "没有找到这个打卡项。");
      return;
    }

    const today = getDateKey();
    const existing = item.completions.find((entry) => entry.date === today);

    if (!existing) {
      item.completions.unshift({
        date: today,
        completedAt: new Date().toISOString()
      });
      item.completions = item.completions.slice(0, 365);
      item.updatedAt = new Date().toISOString();
      writeStore(store);
    }

    sendJson(res, 200, {
      item: serializeCheckinItem(item, store)
    });
    return;
  }

  if (pathname === "/api/checkins/reminders" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const itemId = typeof body.itemId === "string" ? body.itemId : "";
    const message = trimText(body.message, 240);
    const item = findCheckinItemById(store, itemId);

    if (!item || item.visibility !== "friends") {
      sendError(res, 404, "没有找到可以提醒的好友打卡项。");
      return;
    }

    if (item.userId === auth.user.id) {
      sendError(res, 400, "不能提醒自己的打卡项。");
      return;
    }

    if (!areFriends(store, auth.user.id, item.userId)) {
      sendError(res, 403, "只有好友之间才能互相查看和提醒计划。");
      return;
    }

    if (getTodayCompletion(item)) {
      sendError(res, 409, "对方今天已经完成这项打卡了。");
      return;
    }

    const reminder = createNotification(store, {
      type: "checkin-reminder",
      toUserId: item.userId,
      fromUserId: auth.user.id,
      itemId: item.id,
      message: message || auth.user.name + " 提醒你看看「" + item.title + "」。"
    });

    writeStore(store);

    sendJson(res, 201, {
      notification: reminder ? serializeNotification(reminder, store, auth.user.id) : null
    });
    return;
  }

  if (pathname === "/api/friends/request" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const userId = typeof body.userId === "string" ? body.userId : "";
    const targetUser = findUserById(store, userId);

    if (!targetUser) {
      sendError(res, 404, "没有找到这个用户。");
      return;
    }

    if (targetUser.id === auth.user.id) {
      sendError(res, 400, "不能给自己发送好友申请。");
      return;
    }

    if (areFriends(store, auth.user.id, targetUser.id)) {
      sendError(res, 409, "你们已经是好友了。");
      return;
    }

    const existingPending = store.friendRequests.find((request) => {
      if (request.status !== "pending") {
        return false;
      }

      const sameDirection = request.fromUserId === auth.user.id && request.toUserId === targetUser.id;
      const reverseDirection = request.fromUserId === targetUser.id && request.toUserId === auth.user.id;
      return sameDirection || reverseDirection;
    });

    if (existingPending) {
      sendError(res, 409, "好友申请已经在路上了。");
      return;
    }

    const request = {
      id: createId("friend-request"),
      fromUserId: auth.user.id,
      toUserId: targetUser.id,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    store.friendRequests.unshift(request);
    createNotification(store, {
      type: "friend-request",
      toUserId: targetUser.id,
      fromUserId: auth.user.id,
      requestId: request.id,
      message: auth.user.name + " 想加你为好友。"
    });
    writeStore(store);

    sendJson(res, 201, {
      request: serializeFriendRequest(request, store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/friends/respond" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const decision = body.decision === "rejected" ? "rejected" : "accepted";
    const request = findFriendRequestById(store, requestId);

    if (!request || request.toUserId !== auth.user.id) {
      sendError(res, 404, "没有找到这条好友申请。");
      return;
    }

    if (request.status !== "pending") {
      sendError(res, 409, "这条好友申请已经处理过了。");
      return;
    }

    request.status = decision;
    request.updatedAt = new Date().toISOString();

    if (decision === "accepted") {
      createNotification(store, {
        type: "friend-accept",
        toUserId: request.fromUserId,
        fromUserId: auth.user.id,
        requestId: request.id,
        message: auth.user.name + " 通过了你的好友申请。"
      });
    }

    writeStore(store);

    sendJson(res, 200, {
      request: serializeFriendRequest(request, store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/chats" && method === "GET") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    sendJson(res, 200, {
      conversations: buildConversationList(store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/chats/messages" && method === "GET") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const userId = url.searchParams.get("userId") || "";
    const targetUser = findUserById(store, userId);

    if (!targetUser || !areFriends(store, auth.user.id, userId)) {
      sendError(res, 403, "只有好友之间才能聊天。");
      return;
    }

    markMessagesRead(store, auth.user.id, userId);
    const freshStore = readStore();
    const messages = freshStore.messages
      .filter((message) => {
        const sameForward = message.fromUserId === auth.user.id && message.toUserId === userId;
        const sameBackward = message.fromUserId === userId && message.toUserId === auth.user.id;
        return sameForward || sameBackward;
      })
      .sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")))
      .map((message) => serializeMessage(message, freshStore, auth.user.id));

    sendJson(res, 200, {
      user: getPublicUser(targetUser),
      messages
    });
    return;
  }

  if (pathname === "/api/chats/messages" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const userId = typeof body.userId === "string" ? body.userId : "";
    const content = trimText(body.content, 2000);
    const targetUser = findUserById(store, userId);

    if (!targetUser || !areFriends(store, auth.user.id, userId)) {
      sendError(res, 403, "只有好友之间才能聊天。");
      return;
    }

    if (!content) {
      sendError(res, 400, "聊天内容不能为空。");
      return;
    }

    const message = {
      id: createId("message"),
      fromUserId: auth.user.id,
      toUserId: targetUser.id,
      content,
      createdAt: new Date().toISOString(),
      readAt: ""
    };

    store.messages.push(message);
    createNotification(store, {
      type: "chat-message",
      toUserId: targetUser.id,
      fromUserId: auth.user.id,
      messageId: message.id,
      message: auth.user.name + " 给你发来了一条新消息。"
    });
    writeStore(store);

    sendJson(res, 201, {
      message: serializeMessage(message, store, auth.user.id)
    });
    return;
  }

  if (pathname === "/api/notifications/read" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const notificationId = typeof body.notificationId === "string" ? body.notificationId : "";
    const now = new Date().toISOString();

    if (notificationId) {
      const notification = findNotificationById(store, notificationId);
      if (!notification || notification.toUserId !== auth.user.id) {
        sendError(res, 404, "没有找到这条提醒。");
        return;
      }
      notification.readAt = now;
    } else {
      store.notifications.forEach((notification) => {
        if (notification.toUserId === auth.user.id && !notification.readAt) {
          notification.readAt = now;
        }
      });
    }

    writeStore(store);
    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname === "/api/logout" && method === "POST") {
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice("Bearer ".length).trim();
      store.sessions = store.sessions.filter((session) => session.token !== token);
      writeStore(store);
    }

    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname === "/api/users/delete" && method === "POST") {
    const auth = getSessionFromRequest(req, store);
    if (!auth) {
      sendError(res, 401, "当前登录态已失效，请重新登录。");
      return;
    }

    const body = await parseJsonBody(req);
    const password = typeof body.password === "string" ? body.password : "";

    if (!password) {
      sendError(res, 400, "请输入当前账户密码后再删除。");
      return;
    }

    if (!verifySecret(password, auth.user.passwordSalt, auth.user.passwordHash)) {
      sendError(res, 401, "密码验证失败，当前用户不会被删除。");
      return;
    }

    const ownedBlogs = store.blogs.filter((blog) => blog.userId === auth.user.id);
    removeUserFiles(auth.user, ownedBlogs);

    store.users = store.users.filter((user) => user.id !== auth.user.id);
    store.sessions = store.sessions.filter((session) => session.userId !== auth.user.id);
    store.blogs = store.blogs.filter((blog) => blog.userId !== auth.user.id);
    store.blogs.forEach((blog) => {
      blog.likeUserIds = Array.isArray(blog.likeUserIds)
        ? blog.likeUserIds.filter((userId) => userId !== auth.user.id)
        : [];
      blog.comments = Array.isArray(blog.comments)
        ? blog.comments.filter((comment) => comment.userId !== auth.user.id)
        : [];
    });
    store.checkinItems = store.checkinItems.filter((item) => item.userId !== auth.user.id);
    store.notifications = store.notifications.filter(
      (notification) => notification.toUserId !== auth.user.id && notification.fromUserId !== auth.user.id
    );
    store.friendRequests = store.friendRequests.filter(
      (request) => request.toUserId !== auth.user.id && request.fromUserId !== auth.user.id
    );
    store.messages = store.messages.filter(
      (message) => message.toUserId !== auth.user.id && message.fromUserId !== auth.user.id
    );

    writeStore(store);

    sendJson(res, 200, { success: true });
    return;
  }

  if (pathname === "/api/recovery/question" && method === "GET") {
    const userId = url.searchParams.get("userId") || "";
    const user = findUserById(store, userId);

    if (!user) {
      sendError(res, 404, "没有找到这个用户。");
      return;
    }

    sendJson(res, 200, {
      userId: user.id,
      question: user.securityQuestion
    });
    return;
  }

  if (pathname === "/api/recovery/reset" && method === "POST") {
    const body = await parseJsonBody(req);
    const userId = typeof body.userId === "string" ? body.userId : "";
    const answer = typeof body.securityAnswer === "string" ? body.securityAnswer : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    const confirmPassword = typeof body.confirmPassword === "string" ? body.confirmPassword : "";
    const user = findUserById(store, userId);

    if (!user) {
      sendError(res, 404, "没有找到这个用户。");
      return;
    }

    if (!answer.trim()) {
      sendError(res, 400, "请输入密保答案。");
      return;
    }

    if (!verifySecret(normalizeSecretAnswer(answer), user.securityAnswerSalt, user.securityAnswerHash)) {
      sendError(res, 401, "密保答案不正确。");
      return;
    }

    if (!isValidPassword(newPassword)) {
      sendError(res, 400, "新密码需要 8-16 位，只能使用字母和数字，并且必须同时包含两者。");
      return;
    }

    if (newPassword !== confirmPassword) {
      sendError(res, 400, "两次输入的新密码不一致。");
      return;
    }

    const nextPassword = hashSecret(newPassword);
    user.passwordHash = nextPassword.hash;
    user.passwordSalt = nextPassword.salt;
    store.sessions = store.sessions.filter((session) => session.userId !== user.id);
    writeStore(store);

    sendJson(res, 200, { success: true });
    return;
  }

  sendError(res, 404, "接口不存在。");
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendError(res, 400, "Bad Request");
    return;
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApiRequest(req, res, url);
      return;
    }

    if (!["GET", "HEAD"].includes(req.method || "GET")) {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method Not Allowed");
      return;
    }

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") {
      pathname = "/index.html";
    }

    if (pathname.startsWith("/uploads/")) {
      const requestedPath = path.normalize(path.join(uploadsDir, pathname.replace(/^\/uploads\//, "")));
      if (!requestedPath.startsWith(uploadsDir)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }

      sendFile(res, requestedPath, req.method || "GET");
      return;
    }

    const requestedPath = path.normalize(path.join(publicDir, pathname));
    if (!requestedPath.startsWith(publicDir)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }

    fs.stat(requestedPath, (error, stats) => {
      if (!error && stats.isFile()) {
        sendFile(res, requestedPath, req.method || "GET");
        return;
      }

      sendFile(res, path.join(publicDir, "index.html"), req.method || "GET");
    });
  } catch (error) {
    if (error && error.message === "invalid_json") {
      sendError(res, 400, "请求数据不是有效的 JSON。");
      return;
    }

    if (error && error.message === "payload_too_large") {
      sendError(res, 413, "请求体过大，请压缩图片后再试。");
      return;
    }

    console.error(error);
    sendError(res, 500, "服务器内部错误。");
  }
});

server.listen(port, host, () => {
  console.log(`Homepage available at http://${host}:${port}`);
});
