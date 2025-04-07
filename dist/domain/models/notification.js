/**
 * @file Notification domain model
 * Contains the core notification entity and related types
 */
/**
 * EntityType enum for categorizing notifications
 */
export var EntityType;
(function (EntityType) {
    EntityType["GENERIC"] = "notification:generic";
    EntityType["BOE_DOCUMENT"] = "boe:document";
    EntityType["BOE_RESOLUTION"] = "boe:resolution";
    EntityType["BOE_ANNOUNCEMENT"] = "boe:announcement";
    EntityType["REAL_ESTATE_LISTING"] = "real-estate:listing";
    EntityType["REAL_ESTATE_PRICE_CHANGE"] = "real-estate:price-change";
})(EntityType || (EntityType = {}));
/**
 * NotificationStatus enum for tracking notification state
 */
export var NotificationStatus;
(function (NotificationStatus) {
    NotificationStatus["UNREAD"] = "unread";
    NotificationStatus["READ"] = "read";
    NotificationStatus["ARCHIVED"] = "archived";
})(NotificationStatus || (NotificationStatus = {}));
//# sourceMappingURL=notification.js.map