# SkinTel Architecture

SkinTel is a CS2 trading and market intelligence platform. Users browse the live CSGOEmpire market, set watchlist price alerts, post and find trades, chat in real-time, and receive push notifications.

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Tech Stack](#2-tech-stack)
3. [Frontend](#3-frontend)
4. [Backend](#4-backend)
5. [Chrome Extension](#5-chrome-extension)
6. [Socket.IO Events](#6-socketio-events)
7. [Key Flows](#7-key-flows)
8. [Database Models](#8-database-models)
9. [Background Jobs](#9-background-jobs)
10. [Push Notifications (FCM)](#10-push-notifications-fcm)
11. [Deployment](#11-deployment)
12. [Environment Variables](#12-environment-variables)
13. [Known Limitations](#13-known-limitations)

---

## 1. Project Structure

```
/client        React + Vite frontend
/server        Express + Socket.IO backend
/extension     Chrome extension (Steam inventory import)
/.claude       Claude Code local settings
```

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Vite, React Router, Context API, Socket.IO Client |
| Backend | Node.js, Express, MongoDB, Mongoose, Socket.IO |
| Realtime | Socket.IO (bidirectional), Firebase Cloud Messaging (push) |
| Auth | JWT (localStorage) + Steam OpenID OAuth |
| Market Data | CSGOEmpire WebSocket (`empireMarketSocket.js`) |
| Hosting | Vercel (frontend), Render (backend) |

---

## 3. Frontend

### 3.1 Entry Point

**`client/src/main.jsx`** — Registers PWA service worker, wraps app in providers:
```
AuthProvider → SocketProvider → ChatProvider → ChatPanelProvider
```

### 3.2 Routing (`App.jsx`)

| Path | Component | Auth Required |
|------|-----------|:---:|
| `/` | SmartHome (landing or home) | — |
| `/login` | Login | — |
| `/signup` | Redirects to /login | — |
| `/privacy` | Privacy | — |
| `/steam/callback` | SteamCallback | — |
| `/chat` | ChatPage | ✓ |
| `/market` | Market | ✓ |
| `/watchlist` | Watchlist | ✓ |
| `/alerts` | Alerts | ✓ |
| `/item/:slug` | ItemPage | ✓ |
| `/auctions` | AuctionsPage | ✓ |
| `/inventory` | SteamInventory | ✓ |
| `/trade` | TradePage | ✓ |
| `/trade/notifications` | TradeNotificationsPage | ✓ |
| `/trade/:id` | TradeDetailPage | ✓ |
| `*` | NotFound | — |

### 3.3 Pages

#### Auth & Landing
- `pages/landing/Landing.jsx` — Public landing page
- `pages/login/Login.jsx` — Email + password login
- `pages/signup/Signup.jsx` — Registration
- `pages/steam/SteamCallback.jsx` — Steam OAuth callback (reads JWT from URL, stores in localStorage)
- `pages/Privacy.jsx`

#### Market
- `pages/market/Market.jsx` — Item listing, search, filters
- `pages/market/ItemPage.jsx` — Single item detail (route `/item/:slug`)
- `pages/market/ItemCard.jsx` — Item card component
- `pages/market/FiltersBar.jsx` — Category/wear/price filters
- `pages/market/PriceSidebar.jsx` — Price history & stats

#### Trade System
- `pages/trade/TradePage.jsx` — Trade feed + post creation
- `pages/trade/TradePostCard.jsx` — Trade post card
- `pages/trade/TradeDetailPage.jsx` — Single trade detail with comments
- `pages/trade/TradeConversation.jsx` — Comments section
- `pages/trade/TradeNotificationsPage.jsx` — Match notifications
- `pages/trade/TradeItemCard.jsx` — Item card inside trades
- `pages/trade/SearchTradesTab.jsx` — Search/filter trade posts

#### Watchlist & Alerts
- `pages/components/watch/Watchlist.jsx` — Manage watch rules
- `pages/components/watch/AddWatchForm.jsx` — Add rule form
- `pages/components/watch/WatchRuleCard.jsx` — Single rule display
- `pages/alerts/Alerts.jsx` — Triggered alerts list
- `pages/Popup/RealtimeAlertPopup.jsx` — In-app alert popup

#### Chat & Social
- `pages/chat/ChatPage.jsx` — Main chat page
- `pages/chat/ChatWindow.jsx` — Message area
- `pages/chat/ConversationsSidebar.jsx` — Conversation list
- `pages/chat/ChatShell.jsx` — Chat layout wrapper
- `pages/chat/CreateGroupModal.jsx` — Create group
- `pages/chat/MembersSidebar.jsx` — Group members

#### Inventory
- `pages/steam/SteamInventory.jsx` — Import/view inventory

#### Layout
- `pages/components/AppLayout.jsx` — Navbar + sidebar wrapper
- `pages/components/ProtectedLayout.jsx` — Auth gate wrapper
- `pages/components/Navbar.jsx` — Top navigation
- `pages/components/GlobalChatDock.jsx` — Always-visible chat dock

### 3.4 Context

#### `AuthContext` (`context/AuthContext.jsx`)
Global auth state.

| Key | Type | Description |
|-----|------|-------------|
| `token` | string | JWT from localStorage |
| `user` | object | Full user profile |
| `isAuthed` | boolean | Whether user is authenticated |
| `loading` | boolean | Auth check in progress |
| `loginWithToken(token)` | fn | Store token, fetch user |
| `logout()` | fn | Clear token + state |
| `updateUserSetting(key, val)` | fn | Optimistic setting update |

On mount: reads token → calls `GET /api/auth/me` → sets user.

#### `SocketContext` (`context/SocketContext.jsx`)
Manages the Socket.IO connection. On connect, emits `join_user(userId)` to join personal room `user:{userId}`.

**CustomEvent bridge:** SocketContext re-emits incoming Socket.IO events as DOM `CustomEvent`s on `window`, so hooks can subscribe without importing the socket directly. Pattern:
```js
// SocketContext emits:
window.dispatchEvent(new CustomEvent('socket:price_alert', { detail: payload }))

// Hook consumes via useSocketEvent:
useSocketEvent('price_alert', (payload) => { ... })
```
This decouples hooks from the socket lifecycle. `useSocketEvent` (in `hooks/`) is the standard way to listen — never attach raw Socket.IO listeners in components.

#### `ChatContext` / `ChatPanelContext`
Chat state + panel open/close state.

### 3.5 Key Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | Read AuthContext |
| `useWatchlist` | CRUD watch rules |
| `usePushNotifications` | Register FCM token, request permission |
| `useChat` | Socket listeners for chat/DM/group |
| `useSocketEvent(event, cb)` | Generic Socket.IO listener |
| `useMarket` | Market item filtering |
| `useSkinSuggestions` | Similar skin suggestions |
| `useSocial` | Social/friendship state |

### 3.6 Services & Utilities

| File | Purpose |
|------|---------|
| `lib/api.js` | Axios instance with `Authorization: Bearer` interceptor |
| `lib/firebase.js` | Firebase Web SDK init + FCM |
| `lib/storage.js` | `getToken()` / `setToken()` / `clearToken()` |
| `lib/alertSound.js` | Alert sound playback |
| `lib/marketItem.js` | Item normalization |
| `services/chatService.js` | Chat API calls |
| `services/itemsService.js` | Market item API calls |
| `utils/tradeMatch.js` | Trade item scoring logic |
| `utils/wear.js` | Wear string helpers |
| `utils/format.js` | Data formatting |

---

## 4. Backend

### 4.1 Entry Point (`server/server.js`)

Default port: `5055`. Startup sequence:

1. Firebase Admin SDK init (non-blocking)
2. HTTP server binds to `PORT`
3. MongoDB connection (`MONGO_URI`)
4. Socket.IO attaches to server
5. Empire market WebSocket connects (non-blocking)
6. Background jobs start: `startAlertEngine()`, `startMarketWorker()`, alert TTL cleanup

CORS origins: `CLIENT_URL`, `CLIENT_ORIGIN`, `CORS_ORIGIN`, `localhost:5173`.

### 4.2 API Routes

All routes prefixed `/api/`.

#### Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/signup` | — | Register user, return JWT |
| POST | `/login` | — | Email + password login, return JWT |
| GET | `/me` | ✓ | Return authenticated user profile |
| PATCH | `/settings` | ✓ | Update settings (e.g. `tradeMatchAlertsEnabled`) |
| POST | `/logout` | — | Client-side logout helper |

#### Watchlist — `/api/watch`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/` | ✓ | List user's watch rules |
| POST | `/` | ✓ | Create watch rule |
| PATCH | `/:id` | ✓ | Update rule |
| DELETE | `/:id` | ✓ | Remove rule |

#### Alerts — `/api/alerts`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/` | ✓ | List triggered alerts (AlertLog) |
| PATCH | `/:id/read` | ✓ | Mark alert as read |
| DELETE | `/:id` | ✓ | Delete alert |
| GET | `/ping` | — | Alert system health check |
| GET | `/stats` | ✓ | Pipeline performance metrics |
| POST | `/stats/reset` | ✓ | Reset metrics |

#### Trade — `/api/trades`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/` | ✓ | List active trade posts (paginated) |
| POST | `/` | ✓ | Create trade post |
| GET | `/mine` | ✓ | My trade posts |
| GET | `/search-matches` | ✓ | Find posts matching my offer items |
| GET | `/search-by-want` | ✓ | Find posts by what users want |
| GET | `/:id` | ✓ | Get single post |
| PATCH | `/:id` | ✓ | Update post |
| DELETE | `/:id` | ✓ | Delete post |
| PATCH | `/:id/close` | ✓ | Mark post as closed |
| PATCH | `/:id/bump` | ✓ | Bump post (refresh timestamp) |
| GET | `/:id/comments` | ✓ | Get comments on post |
| POST | `/:id/comments` | ✓ | Post comment (triggers match scan) |

#### Trade Notifications — `/api/trade-notifications`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/` | ✓ | List match notifications |
| PATCH | `/:id/read` | ✓ | Mark as read |

#### Steam — `/api/steam`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/login` | — | Redirect to Steam OpenID |
| GET | `/callback` | — | Steam OAuth callback → return JWT |
| GET | `/me` | ✓ | Steam profile info |
| POST | `/import` | ✓ | Receive inventory from extension |
| GET | `/inventory` | ✓ | Get stored inventory |
| GET | `/inventory/:steamId` | ✓ | Fetch live Steam inventory |
| POST | `/inventory/:steamId/refresh` | ✓ | Refresh cached inventory |
| GET | `/trade-url` | ✓ | Get trade URL |
| POST | `/trade-url` | ✓ | Save trade URL |
| GET | `/manual` | ✓ | List manually added items |
| POST | `/manual` | ✓ | Add manual item |
| DELETE | `/manual/:id` | ✓ | Remove manual item |

#### Push Notifications — `/api/push`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| POST | `/register` | ✓ | Register FCM device token |
| DELETE | `/register` | ✓ | Unregister token |
| POST | `/test` | ✓ | Send test notification |
| GET | `/tokens` | ✓ | List registered devices |

#### Auction Alerts — `/api/auction-alerts`

| Method | Path | Auth | Description |
|--------|------|:----:|-------------|
| GET | `/` | ✓ | List auction alert rules |
| POST | `/` | ✓ | Create auction alert rule |
| PATCH | `/:id` | ✓ | Update rule |
| DELETE | `/:id` | ✓ | Delete rule |
| POST | `/run-once` | ✓ | Trigger immediate scan |

#### Other

- `/api/empire/...` — CSGOEmpire API proxy routes
- `/api/user-filters/` — User preference filter CRUD
- `/api/items/...` — Market item search and browsing
- `/api/auctions/` — Auction listings
- `/api/chat/` — Chat message CRUD
- `/api/social/...` — Follow/friend/block
- `/api/dm/` — Direct message conversations

### 4.3 Controllers

| File | Responsibilities |
|------|----------------|
| `auth.controllers.js` | signup, login, me, logout, updateSettings |
| `trade.controller.js` | CRUD posts, comments, match scanning, notifications |
| `steam.controller.js` | Steam OAuth, inventory import, trade URL |
| `alerts.controller.js` | Alert scanning, processLiveItemForAlerts |
| `push.controller.js` | FCM token register/unregister, test push |
| `watchlist.controllers.js` | WatchRule CRUD |
| `chat.controller.js` | Socket chat handlers |
| `items.controllers.js` | Market item lookup and filtering |

### 4.4 Services

| File | Responsibilities |
|------|----------------|
| `alertEngine.js` | Background job: scans market cache vs WatchRules every 15s |
| `alertRules.js` | `shouldTriggerAlert()`, `buildAlertPayload()`, `makeDedupeKey()` |
| `alertStats.js` | Performance counters (items scanned, alerted, FCM sent, latency) |
| `auctionAlertEngine.js` | Scans auction cache vs AuctionAlertRules |
| `auctionCache.js` | In-memory auction listing cache (upsert/remove/getAll) |
| `empireMarketSocket.js` | WebSocket to Empire trade server; ingests new/updated/deleted items |
| `fcm.js` | Firebase Admin push delivery; token cache (30s TTL); dedup 120s window |
| `marketCache.js` | In-memory market item cache with normalization |
| `marketIngest.js` | Normalizes raw Empire items to internal format |
| `marketWorker.js` | Periodic stale item cleanup |
| `priceProvider.js` | Aggregates prices from Empire API + cache |
| `safeFetchMarket.js` | Retry wrapper with exponential backoff for market API |

### 4.5 Middleware

**`middleware/protectRoute.js`**
- Reads `Authorization: Bearer {token}` header
- Verifies JWT (`JWT_SECRET`)
- Attaches `req.user = {_id, username, ...}`
- Returns `401` on missing/invalid token

---

## 5. Chrome Extension

### Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (v3) |
| `content.js` | Content script on Steam inventory pages |
| `background.js` | Service worker: accumulates chunks, POSTs to backend |
| `popup.html` / `popup.js` | Extension popup UI |

### Import Flow

1. **Content script** runs on `steamcommunity.com/*/inventory/*`
   - Reads `window.g_rgAssets[730][2]` (CS2 items) and `window.g_rgDescriptions[730][2]`
   - Chunks items into 100-item batches
   - Sends each chunk via `chrome.runtime.sendMessage(SKINTEL_SEND, {items, steamId, token})`

2. **Background service worker**
   - Accumulates chunks in a `pendingChunks` map
   - On final chunk, POSTs to `POST /api/steam/import`:
     ```json
     { "items": [...], "steamId": "..." }
     ```
   - Includes `Authorization: Bearer {token}` header

3. **Backend `extensionImport()`**
   - Sanitizes items to allowlisted fields (no arbitrary data)
   - Upserts `ImportedInventory` document (one per user)
   - Returns `{count, steamId}`

### Extension Permissions

- `storage`, `activeTab`, `scripting`, `tabs`
- Host: `https://steamcommunity.com/*`

---

## 6. Socket.IO Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join_user` | `userId` | Join personal room `user:{userId}` |
| `chat:join` | `{roomId}` | Join chat room, receive history |
| `chat:message` | `{roomId, text}` | Send message to room |
| `chat:typing` | `{roomId}` | Broadcast typing status |
| `chat:stop_typing` | `{roomId}` | Stop typing |
| `group:join` | `{groupId}` | Join private group |
| `group:message` | `{groupId, text}` | Send group message |
| `group:typing` | `{groupId}` | Group typing |
| `group:stop_typing` | `{groupId}` | Stop typing in group |
| `dm:join` | `{convId}` | Join DM conversation |
| `dm:message` | `{convId, text}` | Send DM |
| `dm:typing` | `{convId}` | DM typing |
| `dm:stop_typing` | `{convId}` | Stop typing in DM |
| `trade:join-conv` | `{postId}` | Join trade post room for live comments |
| `trade:leave-conv` | `{postId}` | Leave trade conversation room |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `price_alert` | `{id, userId, name, marketHashName, image, priceCoins, suggestedCoins, discountPct, wear, floatValue, _detectedAt}` | Watchlist alert matched |
| `market:deals` | `[items]` | Live market item batch (broadcast) |
| `item_deleted` | `{itemId}` | Item removed from market |
| `auctions:update` | `[items]` | Auction listing update |
| `trade:new-post` | `post` | New trade post published |
| `trade:match` | `{notification: {id, senderUsername, ...}}` | Trade match for user's post |
| `trade:new-comment` | `payload` | New comment on a post |
| `trade:comment-added` | `payload` | Comment confirmed |
| `chat:history` | `{roomId, messages}` | Message history on room join |
| `chat:message` | `msg` | Incoming chat message |
| `chat:typing` | `{userId, username, roomId}` | User typing |
| `chat:stop_typing` | `{userId, roomId}` | User stopped typing |
| `chat:online_users` | `{roomId, users}` | Online user list |
| `chat:system` | `{id, roomId, text, type}` | System message (join/leave) |
| `chat:error` | `{message}` | Socket error |
| `dm:conversation` | `{conversation}` | Conversation metadata update (sidebar) |
| `dm:message` | `msg` | Incoming DM |

### Socket Rooms

| Room | Populated By | Used For |
|------|-------------|---------|
| `user:{userId}` | `join_user` | Personal alerts, trade matches, DM sidebar |
| `chat:{roomId}` | `chat:join` | Global or named chat rooms |
| `group:{groupId}` | `group:join` | Private group chat |
| `dm:{convId}` | `dm:join` | DM conversation |
| `trade-conv:{postId}` | `trade:join-conv` | Live trade comments |

---

## 7. Key Flows

### 7.1 Authentication

**Email/Password:**
1. `POST /api/auth/signup` or `/api/auth/login` → returns JWT + user
2. Client stores JWT in localStorage via `lib/storage.js`
3. On app mount: `AuthContext` reads JWT → `GET /api/auth/me` → populates user state

**Steam OAuth:**
1. Client navigates to `GET /api/steam/login`
2. Server redirects to Steam OpenID
3. Steam redirects to `GET /api/steam/callback?openid.*`
4. Server verifies OpenID signature → finds or creates User → generates JWT
5. Server redirects client to `{CLIENT_URL}/steam/callback?token={jwt}`
6. `SteamCallback.jsx` reads token from URL → `loginWithToken(token)`

---

### 7.2 Trade Post Lifecycle

**Create:**
1. `POST /api/trades/` `{myOfferItems, lookingForItems, message}`
2. Server creates `TradePost` document
3. Server emits `trade:new-post` broadcast via Socket.IO

**Find Matches (Personalized Deals):**
1. `GET /api/trades/search-matches` with user's offer items as query params
2. Server scans all active `TradePost.lookingForItems`
3. Scores each item match:
   - **100** — exact baseName + wear
   - **75** — same skin, different wear
   - **45** — same weapon
   - **25** — same category (knife/rifle/pistol)
4. Returns posts sorted by score descending

**Comment & Notification:**
1. `POST /api/trades/:id/comments` `{offeredItems, message}`
2. Server persists `TradeComment`
3. Server re-scans: does commenter's items match post owner's lookingFor?
4. If match → creates `TradeMatchNotification` (unique per recipient + post)
5. Emits `trade:match` to owner's room (`user:{ownerId}`)
6. Sends FCM push to owner's devices

---

### 7.3 Watchlist Alert Pipeline

**Setup:**
1. `POST /api/watch/` `{baseName, wear, targetPrice, minDiscountPct, cooldownMin}`
2. Server creates `WatchRule`

**Scan (every 15 seconds):**
1. `alertEngine.js` fetches all enabled `WatchRule` documents
2. For each rule, queries `marketCache` for matching `marketHashName` items
3. For each item hit:
   - Computes `discountPct = (suggestedCoins - priceCoins) / suggestedCoins * 100`
   - Checks `priceCoins ≤ targetPrice` OR `discountPct ≥ minDiscountPct`
   - Checks cooldown: `lastNotifiedAt + cooldownMin` not yet passed
   - Dedup: unique index on `(userId, ruleId, itemId)` in `AlertLog`
4. Creates `AlertLog` document
5. Emits `price_alert` to `user:{userId}` room
6. Calls `fcm.js` → sends FCM push to all registered devices

**Client Receipt:**
1. `SocketContext` receives `price_alert` → dispatches `CustomEvent`
2. `RealtimeAlertPopup` shows in-app popup
3. `Alerts` page lists all `AlertLog` documents via `GET /api/alerts/`
4. `alertSound.js` plays notification sound

---

### 7.4 Auction Alert Pipeline

**Setup:**
1. `POST /api/auction-alerts/` `{category, minProfitCoins, minProfitPct, maxBidPrice, cooldownMin}`

**Scan (triggered by Empire auction events):**
1. Empire socket emits auction item via `empireMarketSocket.js`
2. Item stored in `auctionCache.js`
3. `auctionAlertEngine` scans all enabled `AuctionAlertRule` docs:
   - Matches category + search string + wear
   - Calculates `profit = suggestedPrice - bidPrice`
   - Checks `profit ≥ minProfitCoins` and optionally `profitPct ≥ minProfitPct`
   - Checks `bidPrice ≤ maxBidPrice` if set
   - Respects cooldown (default 10 min)
4. Creates `AlertLog`, emits `price_alert`, sends FCM push

---

### 7.5 Steam Inventory Import

**Via Extension:**
1. User opens Steam inventory page in browser with extension installed
2. Content script reads CS2 items from `window.g_rgAssets[730][2]`
3. Sends to background in 100-item chunks
4. Background POSTs `POST /api/steam/import` with `{items, steamId}`
5. Backend sanitizes to allowlisted fields only
6. Upserts one `ImportedInventory` document per user
7. Returns `{count, steamId}`

**Via Manual JSON:**
1. User pastes inventory JSON on `/inventory` page
2. `POST /api/steam/inventory/import`

**Trade Matching Integration:**
- Imported items appear as selectable items when creating trade posts
- `search-matches` endpoint compares against all active trade posts

---

### 7.6 Push Notification Pipeline

1. **Register:** Client calls `POST /api/push/register` with FCM token → saved as `DeviceToken`
2. **Alert fires:** Alert engine creates `AlertLog`
3. **Deliver:** `fcm.js:sendPushToUser(userId, {title, body, data})`
   - Fetches `DeviceToken` docs for user (30s in-memory cache)
   - Checks dedup: `userId:alertId` within 120s window
   - Sends via Firebase Admin SDK (web push, urgency=high, TTL=60s)
   - Payload includes: title, body, alertId, itemId, click URL
4. **Client:** Service worker (`sw.js`) receives push, shows OS notification, handles click → opens alert page

---

### 7.7 Live Market Data Flow

1. `empireMarketSocket.js` connects to `wss://csgoempire.com/s/`
2. Listens for: `new_item`, `updated_item`, `deleted_item`
3. On `new_item` / `updated_item`:
   - Normalizes via `marketIngest.js`
   - Upserts into `marketCache.js`
   - Calls `processLiveItemForAlerts()` (immediate check, no wait for 15s scan)
   - Batches items into 2s flush window
   - Emits `market:deals` broadcast to all connected clients
4. On `deleted_item`:
   - Removes from `marketCache`
   - Emits `item_deleted` broadcast

---

## 8. Database Models

### User
```
username          String  unique, required
fullName          String
email             String  unique, sparse (Steam users may have none)
passwordHash      String  optional
gender            Enum: male | female | other | unspecified
avatarUrl         String
steamId           String  unique, sparse
steamDisplayName  String
steamProfileUrl   String
tradeUrl          String
tradeMatchAlertsEnabled  Boolean  default: true
```

### WatchRule
```
userId            ObjectId → User  indexed
baseName          String  (e.g. "AK-47 | Redline")
wear              String
marketHashName    String
weapon            String
skin              String
image             String
appId             Number  default: 730
targetPrice       Number  nullable
minDiscountPct    Number  nullable
cooldownMin       Number  default: 5
lastNotifiedAt    Date
lastMatchedItemKey String
```
Index: `{userId, baseName, wear, appId}`

### AlertLog
```
userId            ObjectId → User  indexed
ruleId            ObjectId → WatchRule  indexed
itemId            String  (market item ID)
name, marketHashName, image
priceCoins, suggestedCoins, discountPct
wear, floatValue
source            String  default: "engine"
status            Enum: live | expired | deleted  indexed
isRead            Boolean  indexed
triggeredAt       Date     indexed
```
Unique index: `{userId, ruleId, itemId}`

### AuctionAlertRule
```
userId            ObjectId → User  indexed
category          String  (knife | gloves | rifle | all | ...)
search            String
wear              String
minProfitCoins    Number  required ≥ 0
minProfitPct      Number  nullable
maxBidPrice       Number  nullable
cooldownMin       Number  default: 10
enabled           Boolean default: true  indexed
```

### TradePost
```
ownerUserId       ObjectId → User
ownerSteamId, ownerUsername, ownerAvatarUrl  String
myOfferItems      [{assetId, name, marketHashName, iconUrl, exterior, rarity, quantity}]
lookingForItems   [same]
message           String  max 500
status            Enum: active | closed
matchCount        Number
commentCount      Number
bumpedAt          Date
```
Index: `{status, bumpedAt, createdAt}`

### TradeComment
```
tradePostId       ObjectId → TradePost
senderUserId      ObjectId → User
senderSteamId, senderUsername, senderAvatarUrl
offeredItems      [ItemSnapshot]
message           String  max 1000
readByOwner       Boolean
```

### TradeMatchNotification
```
recipientUserId   ObjectId → User
tradePostId       ObjectId → TradePost
senderUserId      ObjectId → User
senderUsername, senderSteamId, senderAvatarUrl
matchedItems      [ItemSnapshot]
offerItems        [ItemSnapshot]
read              Boolean
```
Unique index: `{recipientUserId, tradePostId}`

### ChatMessage
```
roomId            String  (global | group:{id} | dm:{id})
senderId          ObjectId → User
senderName, senderAvatar
text              String  max 2000
type              Enum: text | system | auction_share
meta              Mixed
```

### DMConversation
```
pairKey           String  unique  ("smallerId_largerId")
participants      [ObjectId]  2 users
lastMessage       String
lastMessageAt     Date
lastSenderId      ObjectId
unread            Mixed  {userId → count}
hiddenFor         [ObjectId]
clearedAt         Mixed  {userId → Date}
```

### DeviceToken
```
userId            ObjectId → User  indexed
token             String  unique  (Firebase registration token)
active            Boolean  indexed
```

### ImportedInventory
```
userId            ObjectId → User  unique
steamId           String
items             [Mixed]  sanitized
importedAt        Date
itemCount         Number
```

### Other Models
- `PrivateGroup` — group chat metadata (name, ownerId, members)
- `ManualInventory` — manually added inventory items
- `InventoryCache` — caches live Steam API inventory
- `MarketSnapshotItem` — market item snapshots
- `UserFilter` — user preference/filter settings
- `Block` — blocked user pairs
- `Friendship` — friendship relationships
- `SystemSettings` — global system settings

---

## 9. Background Jobs

| Job | File | Interval | Description |
|-----|------|----------|-------------|
| Alert Engine | `services/alertEngine.js` | 15s (configurable) | Scans market cache vs all WatchRules |
| Market Worker | `services/marketWorker.js` | Periodic | Removes stale market items |
| Alert Expiry | `server.js` startup | On start + periodic | Marks old alerts as expired/deleted |
| Empire Socket | `services/empireMarketSocket.js` | Continuous | Live WebSocket to Empire trade server |

The alert engine also has an **immediate path**: when Empire emits a `new_item` event, `processLiveItemForAlerts()` runs synchronously so users get sub-second alerts without waiting for the 15s tick.

---

## 10. Push Notifications (FCM)

### Architecture
```
Alert Engine
    ↓
fcm.js:sendPushToUser(userId, payload)
    ↓  (30s cached token lookup)
DeviceToken collection
    ↓
Firebase Admin SDK
    ↓
FCM → Browser/Device
    ↓
Service Worker (sw.js)
    ↓
OS Notification
```

### Permission Grant Flow

1. `usePushNotifications` hook calls `Notification.requestPermission()` on user action (e.g., enabling alerts in settings).
2. If granted, it calls `getToken(messaging, { vapidKey })` from Firebase Web SDK → receives FCM registration token.
3. Token is POSTed to `POST /api/push/register` → stored as `DeviceToken`.
4. If permission is denied or the browser blocks it, `getToken` throws — the hook catches this and sets a local "permission denied" state; the UI should surface this to the user.
5. Token rotation: if Firebase returns `TOKEN_INVALID_REMOVED` during a push, `fcm.js` marks the token inactive and removes it from the cache. The client re-registers on next app load via `usePushNotifications`.

**Common failure points:** permission not yet requested, browser notification blocked at OS level, service worker not registered, VAPID key mismatch, stale token not yet rotated.

### Deduplication
- Key: `userId:alertId`
- Window: 120 seconds
- Prevents duplicate pushes when multiple alert scans fire simultaneously

### FCM Message Shape
```json
{
  "notification": {
    "title": "AK-47 | Redline — $12.50",
    "body": "-23% vs suggested"
  },
  "data": {
    "alertId": "...",
    "itemId": "...",
    "url": "/alerts"
  },
  "webpush": {
    "headers": { "Urgency": "high", "TTL": "60" },
    "notification": { "renotify": true }
  }
}
```

---

## 11. Deployment

### Frontend — Vercel
- Build: `vite build`
- URL: `https://skin-tel.com` (previously `https://skintel-beta.vercel.app`)
- Env: `VITE_API_URL`, `VITE_API_BASE_URL`, Firebase web config keys

### Backend — Render
- Runtime: Node.js
- URL: `https://skintel-app.onrender.com`
- Env: MongoDB URI, JWT secret, Firebase Admin key, Empire API credentials
- Port must be bound within Render's startup timeout

### Extension
- Manual packaging → Chrome Web Store or `.crx` distribution

---

## 12. Environment Variables

### Server (`server/.env`)

```
PORT=5055
NODE_ENV=production

SERVER_URL=https://skintel-app.onrender.com
CLIENT_URL=https://skin-tel.com
CLIENT_ORIGIN=https://skin-tel.com
CORS_ORIGIN=

MONGO_URI=
JWT_SECRET=
JWT_EXPIRES_IN=7d

EMPIRE_API_KEY=
EMPIRE_BASE_URL=https://csgoempire.com/api/v2
EMPIRE_SOCKET_URL=wss://csgoempire.com/s/?EIO=4&transport=websocket
EMPIRE_UID=
EMPIRE_TOKEN=
EMPIRE_PRICE_UNIT=cents
EMPIRE_RATE_LIMIT_MS=500
EMPIRE_TIMEOUT_MS=12000

FIREBASE_PROJECT_ID=skintel-3fbc1
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@skintel-3fbc1.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY=(PEM key — \n as literal backslash-n)

AUCTION_ALERT_TTL_MIN=45
WATCHLIST_ALERT_TTL_HOURS=24
```

### Client (`client/.env`)

```
VITE_API_URL=https://skintel-app.onrender.com/api
VITE_API_BASE_URL=https://skintel-app.onrender.com
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_VAPID_KEY=
```
---

## 13. Known Limitations

These are production constraints — not bugs. Document here so they are considered during debugging and future design decisions.

| Constraint | Detail |
|-----------|--------|
| In-memory market cache | `marketCache.js` is process-local. Lost on server restart or Render cold start. Items re-populate as Empire sends events; brief post-restart gap is expected. |
| In-memory auction cache | `auctionCache.js` same as above. Users may miss auction alerts during a deploy or cold start. |
| No horizontal scaling | Socket.IO rooms are in-process. Running multiple server instances would split rooms — users on different instances wouldn't receive each other's events. Render is configured for a single instance. |
| JWT cannot be revoked | Tokens have a 7-day TTL set by `JWT_EXPIRES_IN`. There is no token blacklist. A compromised token is valid until expiry. Mitigate by keeping `JWT_SECRET` secret and rotating it when exposure is suspected. |
| JWT expiry mid-session | `AuthContext` calls `GET /api/auth/me` on mount with the stored token. If the token is expired, the request returns `401`. `api.js` should intercept this and call `logout()` — verify this interceptor is wired in `lib/api.js`. |
| Empire WebSocket authentication | Uses `EMPIRE_UID` + `EMPIRE_TOKEN`. If credentials expire, the socket connects but receives no events. `empireMarketSocket.js` has reconnect logic but no credential-refresh mechanism. |
| FCM token cache (30s TTL) | `fcm.js` caches device tokens per user for 30 seconds. Token updates (new registration, invalidation) take up to 30s to propagate to in-flight pushes. |
| No automated test suite | There are no unit or integration tests in the repository. Verification is manual. |

---

## Ownership Map

Each feature has a single primary owner.

| Feature | Primary Owner |
|----------|---------------|
| Authentication | auth.controllers.js |
| Steam Login | steam.controller.js |
| Steam Inventory | steam.controller.js |
| Chrome Extension | extension/* |
| Market Cache | marketCache.js |
| Empire WebSocket | empireMarketSocket.js |
| Watchlists | watchlist.controllers.js |
| Alert Engine | alertEngine.js |
| Alert Rules | alertRules.js |
| Auction Alerts | auctionAlertEngine.js |
| Push Notifications | fcm.js |
| Device Tokens | DeviceToken model |
| Socket.IO | server/socket |
| Trade Posts | trade.controller.js |
| Trade Matching | trade.controller.js |
| Chat | chat.controller.js |
| User Filters | user-filters routes |

Always modify the owning system first.

Never patch downstream systems before verifying the owner.

---

## Investigation Order

Always investigate in this order.

1. Logs

↓

2. Reproduce

↓

3. Identify owner

↓

4. Trace request flow

↓

5. Trace response flow

↓

6. Database

↓

7. Socket.IO

↓

8. Frontend

↓

9. UI

Never investigate randomly.

---

## High Risk Files

These files are production critical.

Never modify them casually.

Always understand the complete flow first.

Backend

- server/services/fcm.js
- server/services/alertEngine.js
- server/services/alertRules.js
- server/services/auctionAlertEngine.js
- server/services/empireMarketSocket.js
- server/socket/*
- server/models/DeviceToken.js
- server/models/AlertLog.js
- server/models/WatchRule.js
- server/server.js

Frontend

- client/src/context/AuthContext.jsx
- client/src/context/SocketContext.jsx
- client/src/lib/firebase.js
- client/src/hooks/usePushNotifications.js
- client/public/sw.js

Extension

- extension/background.js
- extension/content.js
- extension/popup.js

Never modify multiple High Risk files in one change unless absolutely required.

---

## Service Dependencies

Watchlist

↓

Alert Engine

↓

Alert Rules

↓

Alert Log

↓

Socket.IO

↓

FCM

↓

Service Worker

↓

Browser Notification

↓

User

---

## Common Production Bugs

### Duplicate Alerts

Possible Causes

- Cooldown
- AlertState
- AlertLog
- Duplicate Socket event
- Duplicate Empire event

Check

- Alert Engine
- Alert Rules
- Alert Log
- Socket emit
- FCM

---

### Missing Push Notification

Possible Causes

- No matching rule
- Cooldown active
- Invalid Device Token
- Firebase rejection
- Service Worker
- Notification permission
- Browser restrictions

Check

- Alert Engine logs

↓

- DeviceToken

↓

- Firebase

↓

- Service Worker

↓

- Browser

---

### Market Item Missing

Possible Causes

- Empire WebSocket
- Market Cache
- Normalization
- API filtering
- Frontend filters

---

### Trade Match Missing

Possible Causes

- Matching algorithm
- Inventory import
- Search filters
- Closed trade
- Hidden trade

---

### Extension Import Failed

Possible Causes

- Steam inventory parsing
- Authentication
- API request
- Import endpoint
- Sanitization

