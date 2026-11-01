declare const GetActiveAuctions: {
    readonly response: {
        readonly "200": {
            readonly type: "object";
            readonly properties: {
                readonly success: {
                    readonly type: "boolean";
                    readonly default: true;
                    readonly examples: readonly [true];
                };
                readonly active_auctions: {
                    readonly type: "array";
                    readonly items: {
                        readonly type: "object";
                        readonly properties: {
                            readonly auction_ends_at: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [1666083221];
                            };
                            readonly auction_highest_bid: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [227];
                            };
                            readonly auction_highest_bidder: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [303119];
                            };
                            readonly auction_number_of_bids: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [1];
                            };
                            readonly custom_price_percentage: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [0];
                            };
                            readonly icon_url: {
                                readonly type: "string";
                                readonly examples: readonly ["-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXX7gNTPcUmqBwTTR7SQb37g5vWCwlxdFEC5uyncgZi0vGQJWwQudm0xtTexaD2ZOmClyVB5sL8h7mCHA"];
                            };
                            readonly is_commodity: {
                                readonly type: "boolean";
                                readonly default: true;
                                readonly examples: readonly [true];
                            };
                            readonly market_name: {
                                readonly type: "string";
                                readonly examples: readonly ["Name Tag"];
                            };
                            readonly market_value: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [227];
                            };
                            readonly name_color: {
                                readonly type: "string";
                                readonly examples: readonly ["D2D2D2"];
                            };
                            readonly preview_id: {};
                            readonly price_is_unreliable: {
                                readonly type: "boolean";
                                readonly default: true;
                                readonly examples: readonly [true];
                            };
                            readonly stickers: {
                                readonly type: "array";
                                readonly items: {};
                            };
                            readonly wear: {};
                            readonly published_at: {
                                readonly type: "string";
                                readonly examples: readonly ["2022-10-18T08:51:02.803761Z"];
                            };
                            readonly id: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [11204];
                            };
                            readonly depositor_stats: {
                                readonly type: "object";
                                readonly properties: {
                                    readonly delivery_rate_recent: {
                                        readonly type: "number";
                                        readonly default: 0;
                                        readonly examples: readonly [0.6];
                                    };
                                    readonly delivery_rate_long: {
                                        readonly type: "number";
                                        readonly default: 0;
                                        readonly examples: readonly [0.7567567567567568];
                                    };
                                    readonly delivery_time_minutes_recent: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [7];
                                    };
                                    readonly delivery_time_minutes_long: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [7];
                                    };
                                    readonly steam_level_min_range: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [5];
                                    };
                                    readonly steam_level_max_range: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [10];
                                    };
                                    readonly user_has_trade_notifications_enabled: {
                                        readonly type: "boolean";
                                        readonly default: true;
                                        readonly examples: readonly [false];
                                    };
                                    readonly user_is_online: {};
                                };
                            };
                            readonly above_recommended_price: {
                                readonly type: "integer";
                                readonly default: 0;
                                readonly examples: readonly [-5];
                            };
                        };
                    };
                };
            };
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {};
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "429": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
declare const GetActiveTrades: {
    readonly response: {
        readonly "200": {
            readonly type: "object";
            readonly properties: {
                readonly success: {
                    readonly type: "boolean";
                    readonly default: true;
                    readonly examples: readonly [true];
                };
                readonly data: {
                    readonly type: "object";
                    readonly properties: {
                        readonly deposits: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "object";
                                readonly properties: {
                                    readonly id: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [291452362];
                                    };
                                    readonly total_value: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [499];
                                    };
                                    readonly item_id: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [4209852853];
                                    };
                                    readonly item: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly app_id: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [730];
                                            };
                                            readonly context_id: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [2];
                                            };
                                            readonly type: {
                                                readonly type: "string";
                                                readonly examples: readonly ["Mil-Spec Grade Sniper Rifle"];
                                            };
                                            readonly asset_id: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [4189826749];
                                            };
                                            readonly blue_percentage: {};
                                            readonly created_at: {
                                                readonly type: "string";
                                                readonly examples: readonly ["2024-02-25 00:01:01"];
                                            };
                                            readonly fade_percentage: {};
                                            readonly full_position: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [1];
                                            };
                                            readonly icon_url: {
                                                readonly type: "string";
                                                readonly examples: readonly ["-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FA957P3dcjFH7c6Jh4uem_vnDKnUkmld_cBOhuDG_Zi7iQ2w_RU5Z26md4TDewQ-aF7ZrAC6wL-81pK9tZXPy3pr7yl243eLmgv3309_PudPMg"];
                                            };
                                            readonly id: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [4209852853];
                                            };
                                            readonly is_commodity: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [false];
                                            };
                                            readonly market_name: {
                                                readonly type: "string";
                                                readonly examples: readonly ["AWP | Acheron (Factory New)"];
                                            };
                                            readonly market_value: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [499];
                                            };
                                            readonly name_color: {
                                                readonly type: "string";
                                                readonly examples: readonly ["D2D2D2"];
                                            };
                                            readonly position: {};
                                            readonly preview_id: {
                                                readonly type: "string";
                                                readonly examples: readonly ["44f1edad452a"];
                                            };
                                            readonly price_is_unreliable: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [false];
                                            };
                                            readonly stickers: {
                                                readonly type: "array";
                                                readonly items: {};
                                            };
                                            readonly suggested_price: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [281];
                                            };
                                            readonly tradable: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [true];
                                            };
                                            readonly trade_exists: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [false];
                                            };
                                            readonly tradelock: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [false];
                                            };
                                            readonly updated_at: {
                                                readonly type: "string";
                                                readonly examples: readonly ["2025-02-26 00:00:01"];
                                            };
                                            readonly wear: {
                                                readonly type: "number";
                                                readonly default: 0;
                                                readonly examples: readonly [0.002];
                                            };
                                        };
                                    };
                                    readonly status: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [3];
                                    };
                                    readonly status_message: {
                                        readonly type: "string";
                                        readonly examples: readonly ["Sending"];
                                    };
                                    readonly tradeoffer_id: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [22342312];
                                    };
                                    readonly metadata: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly item_validation: {
                                                readonly type: "object";
                                                readonly properties: {
                                                    readonly numWrongItemDetections: {
                                                        readonly type: "integer";
                                                        readonly default: 0;
                                                        readonly examples: readonly [0];
                                                    };
                                                    readonly validItemDetected: {
                                                        readonly type: "boolean";
                                                        readonly default: true;
                                                        readonly examples: readonly [false];
                                                    };
                                                };
                                            };
                                            readonly expires_at: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [1740426816];
                                            };
                                            readonly trade_url: {
                                                readonly type: "string";
                                                readonly examples: readonly ["https://steamcommunity.com/tradeoffer/new/?partner=100&token=hi"];
                                            };
                                            readonly item_inspected: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [true];
                                            };
                                            readonly partner: {
                                                readonly type: "object";
                                                readonly properties: {
                                                    readonly steam_id: {
                                                        readonly type: "string";
                                                        readonly examples: readonly ["76561198382602085"];
                                                    };
                                                    readonly steam_name: {
                                                        readonly type: "string";
                                                        readonly examples: readonly ["exampleProfile"];
                                                    };
                                                    readonly avatar: {
                                                        readonly type: "string";
                                                        readonly examples: readonly ["https://avatars.steamstatic.com/60d676610e6303f1f5fde66f307dbe753fc91221.jpg"];
                                                    };
                                                    readonly avatar_full: {
                                                        readonly type: "string";
                                                        readonly examples: readonly ["https://avatars.steamstatic.com/60d676610e6303f1f5fde66f307dbe753fc91221_full.jpg"];
                                                    };
                                                    readonly profile_url: {
                                                        readonly type: "string";
                                                        readonly examples: readonly ["https://steamcommunity.com/profiles/76561198382602085"];
                                                    };
                                                    readonly timecreated: {
                                                        readonly type: "integer";
                                                        readonly default: 0;
                                                        readonly examples: readonly [171313223];
                                                    };
                                                    readonly steam_level: {
                                                        readonly type: "integer";
                                                        readonly default: 0;
                                                        readonly examples: readonly [10];
                                                    };
                                                };
                                            };
                                            readonly auction_number_of_bids: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [0];
                                            };
                                        };
                                    };
                                    readonly created_at: {
                                        readonly type: "string";
                                        readonly examples: readonly ["2025-02-26 00:02:02"];
                                    };
                                    readonly updated_at: {
                                        readonly type: "string";
                                        readonly examples: readonly ["2025-02-26 00:03:03"];
                                    };
                                    readonly suggested_price: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [281];
                                    };
                                };
                            };
                        };
                        readonly withdrawals: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "object";
                                readonly properties: {
                                    readonly id: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [26666321];
                                    };
                                    readonly total_value: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [245];
                                    };
                                    readonly item_id: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [221232898];
                                    };
                                    readonly item: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly market_name: {
                                                readonly type: "string";
                                                readonly examples: readonly ["MAC-10 | Allure (Factory New)"];
                                            };
                                            readonly market_value: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [7];
                                            };
                                            readonly icon_url: {
                                                readonly type: "string";
                                                readonly examples: readonly ["-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpou7umeldf0Ob3fDxBvYyJnZOEmPn6MoTdn2xZ_Isj3bGS9oqh3wWy_kU5YWihI9WXcVJrYgvX-gO6w-fm1MS56JuaznowpGB8suVQiM7I"];
                                            };
                                            readonly id: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [221232898];
                                            };
                                            readonly is_commodity: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [false];
                                            };
                                            readonly name_color: {
                                                readonly type: "string";
                                                readonly examples: readonly ["D2D2D2"];
                                            };
                                            readonly price_is_unreliable: {
                                                readonly type: "boolean";
                                                readonly default: true;
                                                readonly examples: readonly [false];
                                            };
                                            readonly suggested_price: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [245];
                                            };
                                        };
                                    };
                                    readonly status: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [3];
                                    };
                                    readonly status_message: {
                                        readonly type: "string";
                                        readonly examples: readonly ["Sending"];
                                    };
                                    readonly tradeoffer_id: {
                                        readonly type: "integer";
                                        readonly default: 0;
                                        readonly examples: readonly [221232898];
                                    };
                                    readonly metadata: {
                                        readonly type: "object";
                                        readonly properties: {
                                            readonly item_validation: {
                                                readonly type: "object";
                                                readonly properties: {
                                                    readonly numWrongItemDetections: {
                                                        readonly type: "integer";
                                                        readonly default: 0;
                                                        readonly examples: readonly [0];
                                                    };
                                                    readonly validItemDetected: {
                                                        readonly type: "boolean";
                                                        readonly default: true;
                                                        readonly examples: readonly [false];
                                                    };
                                                };
                                            };
                                            readonly expires_at: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [1723212836];
                                            };
                                            readonly auction_number_of_bids: {
                                                readonly type: "integer";
                                                readonly default: 0;
                                                readonly examples: readonly [0];
                                            };
                                        };
                                    };
                                    readonly created_at: {
                                        readonly type: "string";
                                        readonly examples: readonly ["2025-02-25 08:08:08"];
                                    };
                                    readonly updated_at: {
                                        readonly type: "string";
                                        readonly examples: readonly ["2025-02-25 09:09:09"];
                                    };
                                };
                            };
                        };
                    };
                };
            };
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {};
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "429": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
declare const Metadata: {
    readonly response: {
        readonly "200": {
            readonly type: "object";
            readonly properties: {
                readonly user: {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [303119];
                        };
                        readonly steam_id: {
                            readonly type: "string";
                            readonly examples: readonly ["76561198106192114"];
                        };
                        readonly steam_id_v3: {
                            readonly type: "string";
                            readonly examples: readonly ["145926386"];
                        };
                        readonly steam_name: {
                            readonly type: "string";
                            readonly examples: readonly ["Artemis"];
                        };
                        readonly avatar: {
                            readonly type: "string";
                            readonly examples: readonly ["https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/4f/4f619bc788f0d41261d2a5ced0e96a281af88479_full.jpg"];
                        };
                        readonly profile_url: {
                            readonly type: "string";
                            readonly examples: readonly ["https://steamcommunity.com/id/G0FastMen/"];
                        };
                        readonly registration_timestamp: {
                            readonly type: "string";
                            readonly examples: readonly ["2016-07-27 23:20:03"];
                        };
                        readonly registration_ip: {
                            readonly type: "string";
                            readonly examples: readonly ["0.0.0.0"];
                        };
                        readonly last_login: {
                            readonly type: "string";
                            readonly examples: readonly ["2021-11-29 13:02:54"];
                        };
                        readonly balance: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_profit: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_bet: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly betback_total: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly bet_threshold: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_trades: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_deposit: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_withdraw: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly withdraw_limit: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly csgo_playtime: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly last_csgo_playtime_cache: {
                            readonly type: "string";
                            readonly examples: readonly ["2016-07-27 23:20:03"];
                        };
                        readonly trade_url: {
                            readonly type: "string";
                            readonly examples: readonly ["https://steamcommunity.com/tradeoffer/new/?partner=145926386&token=ABCDEF"];
                        };
                        readonly trade_offer_token: {
                            readonly type: "string";
                            readonly examples: readonly ["ABCDEF"];
                        };
                        readonly ref_id: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_referral_bet: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_referral_commission: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly ref_permission: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly ref_earnings: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_ref_earnings: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_ref_count: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_credit: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly referral_code: {
                            readonly type: "string";
                            readonly examples: readonly ["Artemis"];
                        };
                        readonly referral_amount: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [50];
                        };
                        readonly muted_until: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [1632354690];
                        };
                        readonly mute_reason: {
                            readonly type: "string";
                            readonly examples: readonly ["Other"];
                        };
                        readonly admin: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly super_mod: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly mod: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly utm_campaign: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly country: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly is_vac_banned: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [2];
                        };
                        readonly steam_level: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [343];
                        };
                        readonly last_steam_level_cache: {
                            readonly type: "string";
                            readonly examples: readonly ["2021-11-30 07:41:07"];
                        };
                        readonly whitelisted: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [1];
                        };
                        readonly total_tips_received: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_tips_sent: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly withdrawal_fee_owed: {
                            readonly type: "string";
                            readonly examples: readonly ["0.0000"];
                        };
                        readonly flags: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly ban: {};
                        readonly balances: {
                            readonly type: "array";
                            readonly items: {};
                        };
                        readonly level: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly xp: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly socket_token: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly user_hash: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly hashed_server_seed: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly intercom_hash: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly roles: {
                            readonly type: "array";
                            readonly items: {};
                        };
                        readonly eligible_for_free_case: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [false];
                        };
                        readonly extra_security_type: {
                            readonly type: "string";
                            readonly examples: readonly ["2fa"];
                        };
                        readonly total_bet_skincrash: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_bet_matchbetting: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_bet_roulette: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_bet_coinflip: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly total_bet_supershootout: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [0];
                        };
                        readonly p2p_telegram_notifications_allowed: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [true];
                        };
                        readonly p2p_telegram_notifications_enabled: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [true];
                        };
                        readonly verified: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [false];
                        };
                        readonly hide_verified_icon: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [false];
                        };
                        readonly unread_notifications: {
                            readonly type: "array";
                            readonly items: {};
                        };
                        readonly last_session: {
                            readonly type: "object";
                            readonly properties: {};
                        };
                        readonly email: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly email_verified: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [false];
                        };
                        readonly eth_deposit_address: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly btc_deposit_address: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly ltc_deposit_address: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly bch_deposit_address: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly steam_inventory_url: {
                            readonly type: "string";
                            readonly examples: readonly ["https://steamcommunity.com/profiles/76561198106192114/inventory/#730"];
                        };
                        readonly steam_api_key: {
                            readonly type: "string";
                            readonly examples: readonly [""];
                        };
                        readonly has_crypto_deposit: {
                            readonly type: "boolean";
                            readonly default: true;
                            readonly examples: readonly [true];
                        };
                        readonly chat_tag: {
                            readonly type: "object";
                            readonly properties: {};
                        };
                        readonly linked_accounts: {
                            readonly type: "array";
                            readonly items: {};
                        };
                        readonly api_token: {
                            readonly type: "string";
                            readonly examples: readonly ["nice try"];
                        };
                    };
                };
                readonly socket_token: {
                    readonly type: "string";
                    readonly examples: readonly [""];
                };
                readonly socket_signature: {
                    readonly type: "string";
                    readonly examples: readonly [""];
                };
            };
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {};
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "429": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
declare const Settings: {
    readonly body: {
        readonly type: "object";
        readonly properties: {
            readonly trade_url: {
                readonly type: "string";
                readonly description: "full_trade_url_here";
            };
            readonly marketplace_privacy_protection_level: {
                readonly type: "string";
                readonly description: "Use 'base' or 'strict'";
                readonly default: "base";
            };
        };
        readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {};
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "429": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
declare const Tipping: {
    readonly body: {
        readonly type: "object";
        readonly properties: {
            readonly code: {
                readonly type: "string";
                readonly description: "Your two-factor authentication code.";
            };
            readonly user_id: {
                readonly type: "string";
                readonly description: "The ID of the user you want to tip. This field is mutually exclusive with steam_id, so it's optional.";
            };
            readonly steam_id: {
                readonly type: "string";
                readonly description: "The Steam ID of the user you want to tip. This field is mutually exclusive with user_id, so it's optional.";
            };
            readonly amount: {
                readonly type: "string";
                readonly description: "The amount you want to tip in coin-cents";
            };
        };
        readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
    };
    readonly response: {
        readonly "200": {
            readonly type: "object";
            readonly properties: {
                readonly success: {
                    readonly type: "boolean";
                    readonly default: true;
                    readonly examples: readonly [true];
                };
                readonly data: {
                    readonly type: "object";
                    readonly properties: {
                        readonly user: {
                            readonly type: "object";
                            readonly properties: {
                                readonly id: {
                                    readonly type: "integer";
                                    readonly default: 0;
                                    readonly examples: readonly [12345];
                                };
                            };
                        };
                        readonly amount: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [100];
                        };
                        readonly balance: {
                            readonly type: "integer";
                            readonly default: 0;
                            readonly examples: readonly [499500];
                        };
                    };
                };
            };
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {};
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "429": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
declare const TransactionHistory: {
    readonly metadata: {
        readonly allOf: readonly [{
            readonly type: "object";
            readonly properties: {
                readonly page: {
                    readonly type: "integer";
                    readonly format: "int32";
                    readonly minimum: -2147483648;
                    readonly maximum: 2147483647;
                    readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
                    readonly description: "Insert the requested page number here.";
                };
            };
            readonly required: readonly [];
        }];
    };
    readonly response: {
        readonly "200": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "400": {
            readonly type: "object";
            readonly properties: {};
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
        readonly "429": {
            readonly $schema: "https://json-schema.org/draft/2020-12/schema#";
        };
    };
};
export { GetActiveAuctions, GetActiveTrades, Metadata, Settings, Tipping, TransactionHistory };
