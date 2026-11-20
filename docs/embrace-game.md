# Embrace Your Horror

## Rollout

Run [embrace-game.sql](sql/embrace-game.sql) in the application's PostgreSQL database before starting the updated backend. This standalone transaction creates the account, inventory, story, and Flutterwave order tables and seeds the Highlands. It can be run again without resetting accounts, purchases, or edited stories. TypeORM migration runners can apply the same schema if that is already part of deployment.

Release the Lan’s Hub `/pages/embrace-game` frontend and backend together because playing now requires a game account. Spectators can still watch without signing in.

If `GET /game/api/profile` fails with SQLSTATE `42703` and PostgreSQL reports `column "fighter_ids" does not exist`, run [embrace-fighters.sql](sql/embrace-fighters.sql) against the same database and schema the backend uses. The script gives existing accounts an empty fighter inventory and preserves any inventories already stored. TypeORM deployments can apply the registered migration with `npm.cmd run migration:run` in PowerShell using the deployment's database configuration.

After committing the upgrade, verify that the column is available and retry the profile request with an existing game session. A successful profile includes a `fighters` array.

```sql
SELECT fighter_ids FROM game_accounts LIMIT 0;
```

Apply [embrace-shop-experience.sql](sql/embrace-shop-experience.sql) or migration `1795219200000-EmbraceShopAndExperience` for account XP and moderator-created shop items. Existing accounts start at level 1 and keep their Cinders and inventory.

Set `NEXT_PUBLIC_GAME_SERVER_URL` to the API and Socket.IO origin. The menu opens **Cinder Forge** for accounts, loadouts, summons, and the shop. For PvP, set the default HP at room creation and override it for any player in the lobby. Players confirm their own loadout before the host starts. A rematch returns everyone to the lobby.

Game moderation uses a game account approved in PostgreSQL. After the moderator registers, provision their account using a parameterized statement.

```sql
UPDATE game_accounts SET moderator = true WHERE username = $1;
```

## Progression

New accounts receive 300 credits, starter gear, two Bloodleaf Tonics, and one Ward Stone. Gear changes combat stats, jobs provide passive bonuses, and item use consumes inventory. The server awards 30 Cinders and 25 XP once per account for each completed PvE or PvP battle in which the player queued an action that resolved. Every 100 XP raises the account level, adding 2 attack and 1 defense to the selected fighter per level gained. Each summon costs 100 credits. A legendary is guaranteed by the tenth pull since the last legendary. Duplicate gear returns 35 credits. The shop also sells gear and consumables at fixed prices. Moderators can publish additional Cinder-priced healing or guard items in the Shop items tab.

Normal actions grant 20 Focus, and taking a hit grants 10. A Limit Break spends 100 Focus. Players can inspect equipment and items before a match. Loadouts are saved to the account and locked for each active PvP match.

Lady Ley and the Grave Chorister are available without a purchase. Their signature moves use existing round rules: successful evasions empower Astral Severance, Crimson Waltz can spend Focus, and the Chorister exploits targets that are wounded, Broken, or Burning. Odd Highlands tiers include the Glasswing Siren and Obsidian Harrower. The tier length and saved checkpoints are unchanged. End-of-battle snapshots include confirmed XP and Cinders for participation and tier completion, not projected rewards.

## Battle reward storage

`game_battle_rewards` stores duplicate-payout guards, while balances and XP live on `game_accounts`. Guards are retained for seven days. Every minute the backend deletes expired guards in batches of 5,000, up to 20 batches per run. The gateway keeps the original server settlement time on the battle across retries; the reward query rejects settlements older than seven days even after their guard has been deleted. This bounds storage to recent battle participation rather than lifetime play. Balances, XP, purchases, and encounter milestones are preserved.

Stop all older backend instances, apply migration `1795478400000-EmbraceBattleRewardRetention` (or [the standalone SQL](sql/embrace-battle-reward-retention.sql)), then start the updated backend. Restarting clears in-memory rooms. Do not run the cleanup alongside an older backend: its reward path can pay an expired retry again. Cleanup starts within a minute and gradually clears the backlog. PostgreSQL can reuse the freed space; normal vacuum does not shrink the database file. This does not retain a permanent per-battle reward history. Unsettled retries older than seven days are intentionally rejected.

## Flutterwave gear checkout

Four companion skills have both Cinder and cash prices (750 Cinders or NGN 1,200 each). Both payment paths grant the same permanent skill. A pending or review cash order blocks buying that same skill with Cinders until resolved. Verified cash unlocks appear in the profile and in that fighter's Skills menu when the player loads into a room. No new schema is required beyond the existing checkout and progression tables. Deploy the backend before the web client so the new fighter IDs are accepted by rooms.

Premium offers include 300 Cinders for ₦1,000, 1,000 Cinders for ₦3,000, stronger equipment at ₦3,500 each, and stronger consumables at ₦500 each. Existing orders for the retired offers can still be fulfilled. The cash offer prices live in `src/game/payments/game-checkout.service.ts`, in kobo. An order keeps the price quoted when it was created.

Set `GAME_CASH_CHECKOUT_ENABLED=true` on the backend to show and activate the cash offers. Checkout uses the existing `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`, `VOTING_PROVIDER_MODE`, and `VOTING_FRONTEND_ORIGIN`. The frontend origin must point to the Lan’s Hub site. Use Flutterwave test mode with a test database. The existing `POST /votes/api/webhooks/flutterwave` handler accepts both game and vote payment notifications, identified by their separate reference prefixes.

Fulfillment requires successful provider verification with the order's exact reference, amount, currency, and mode. The backend grants the purchased item or Cinders and settles the order in one database transaction. A payment mismatch or gear acquired before cash payment settles goes to `REVIEW`. Refunds, chargebacks, and any inventory reversal are handled manually. To investigate a pending or review order, look up the reference below and verify it in Flutterwave before making changes.

```sql
SELECT id, gear_id, amount_minor, currency, status, review_reason,
       provider_reference, provider_transaction_id, created_at, expires_at, fulfilled_at
FROM game_checkout_orders
WHERE id = $1::uuid;
```

If initialization times out, retry using the original request ID. **Check payment** re-verifies a pending order. **Resume checkout** reopens the same hosted link while it's available. If Flutterwave has no record of the order 24 hours after link expiry, **Check payment** releases it so another checkout can start. A late verified charge can still settle.

## Integration

| Method and path | Request or response |
| --- | --- |
| `POST /game/api/auth/register` and `POST /game/api/auth/login` | Send `{ username, password }`. Returns `{ id, username, token }`. |
| `POST /game/api/auth/logout` | Bearer token. Revokes the session and returns 204. |
| `GET /game/api/catalog` | Gear, items, jobs, and summon odds. |
| `GET /game/api/profile` | Bearer token. Returns credits, XP, level progress, combat strength, pity, gear, item counts, loadout, and moderator status. |
| `PUT /game/api/loadout` | Bearer token and `{ job, weapon, armor, item }`. Returns the saved profile. |
| `POST /game/api/purchases` | Bearer token and `{ product, requestId }`. Use `summon` or a catalog ID as the product and a UUID v4 as the request ID. Returns `{ result, profile }`. Retry an uncertain request with the same body. |
| `POST /game/api/admin/shop/items` | Moderator bearer token and `{ requestId, name, effect, power, price }`. Publishes a healing (`heal`) or guard (`guard`) item in the Cinder shop. |
| `GET /game/api/checkout/offers` | Cash offers and the backend availability flag. Prices are in kobo. |
| `POST /game/api/checkout` | Bearer token and `{ requestId, gearId, email }`. Returns the persisted order and its hosted checkout URL when available. Retry with the same UUID v4 and email. |
| `GET /game/api/checkout/orders` | Bearer token. Returns the account's recent checkout orders. |
| `POST /game/api/checkout/:orderId/verify` | Bearer token. Returns the current order after server-side verification. The Flutterwave redirect's status is ignored. Read the profile after `FULFILLED` to refresh inventory. |
| `GET /game/api/story` | Returns `data.initialNodeId` and `data.nodes`. |

Connect Socket.IO with `auth: { gameToken }`. Keep the existing JSON string `message` transport. The server binds room identity to the authenticated account. `CREATE_ROOM` accepts `startingHp` for PvP. `SET_STARTING_HP` accepts `{ playerId, hp, targetId? }` during the lobby. If the host omits `targetId`, HP applies to every player and becomes the default for later arrivals. `REFRESH_LOADOUT` reloads an account's saved choices in the lobby. Toggle readiness with `ROOM_PLAYER_READY` and the `ready` flag. Send `item` and `limit` through `COMBAT_QUEUE_ACTION`. Refresh the profile on `PROFILE_UPDATED`.

## Game administration

If the game tables are already installed, run [embrace-admin.sql](sql/embrace-admin.sql). For a fresh installation, [embrace-game.sql](sql/embrace-game.sql) includes the moderator tables. Open **Game administration** from the Highlands menu with a moderator game account. The console provides live room and player controls, story publishing, inventory adjustments, Flutterwave order status, and moderator activity. The existing bearer token and server-side moderator privilege apply to every admin request.

Use **Story library → Download published JSON** for a copy of the current campaign, or start with [the example story](examples/embrace-story.json). Upload a UTF-8 JSON file up to 1 MB, preview the scene list, and publish when ready. The canonical shape is `{ initialNodeId, nodes }`. A keyed node map with `start` also works. Older `image` and `next` fields become `background` and `nextNodeId`. Older `battle` and `encounter` labels become named opponents. A `random` choice still rolls for an encounter. Uploads can include cutscenes, voice assets, team battles, CPU abilities, and boss phases.

Publishing updates the running server. Active story sessions retain the version they started with. Use **Restart** in the room controls to return a session to the lobby and adopt the latest story. The first upload backs up the original graph, and restoring a version creates a new publication. The console also records the moderator and reason for inventory adjustments. Moderator-set results do not issue ordinary PvE win credits.

Room state and active battles live in memory and reset if the server restarts. Story versions, payment orders, inventory changes, and moderator activity are stored in PostgreSQL.
