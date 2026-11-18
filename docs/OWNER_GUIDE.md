# Owner guide

Log in with your owner account and tap **Owner** in the header (or go to `/admin`).

## Overview
Revenue, orders, visitors, conversion, average order, new accounts and how many shoppers are waiting for restocks — for the last 7, 30, 90 days or 12 months. Charts: visitors per day, revenue per day, the shopping funnel (visited → viewed a product → added to bag → started checkout → paid), devices and operating systems (phone/tablet/desktop, iOS/Android/…), where visitors came from (Instagram, Google, campaign links), orders by state, best-selling sizes and colours, every product's views/adds/sales/waiting, what's running low, and a count of every action recorded. Every chart has “Show as table”.

*Visitor numbers only include shoppers who accepted analytics. Orders and revenue include everyone.*

Tip: share links with `?utm_source=instagram&utm_campaign=drop05` so the dashboard shows which post brought the sales.

## Products
**New product** or click a product to edit. Everything saves together with **Save** (bottom right).

- **Basics**: name, web address, category, the garment shape (oversized tee, boxy tee, hoodie…), status (*Draft* hides it, *Live* shows it, *Archived* retires it), “New” tag.
- **Price**: MRP and discount %. The shop shows the struck-through MRP, the price and “x% off”.
- **Colours**: fabric colour, the name shoppers see, and optionally the print colour. The shop's background takes on the colour the shopper picks.
- **Sizes and stock**: list the sizes, then type stock for every colour × size. “Alert me at” sets when you get the running-low email. Cells show how many shoppers are waiting.
- **Design**: upload front and back artwork as transparent PNGs in a 3:4 shape (e.g. 3000 × 4000 px). The canvas is the printable area; place the art inside it where you want it to sit. The product-image preview on the right shows the front and back the shop will use. Without artwork you can print text instead.
- **Description** and **Details** (one per line).
- **Music**: upload an MP3/M4A. It plays quietly when a shopper opens the product (volume in Settings, 20% by default) and they can mute it. Use music you have the rights to.
- **Previews**: photos and videos (model shots, close-ups, a short clip). Tag a colour to show it first for that colour. Your photos replace the still product images everywhere (cards, product page, search): the first photo is the main picture and the second shows on hover. Video thumbnails are made automatically.
- **Reviews**: add, edit, hide or delete reviews.

## Homepage
Everything on the home page apart from the product rows:
- **Hero slides**: big photos with a title, subtitle and button (add a portrait version for phones). Several rotate every 6 seconds.
- **Collection tiles**: the “Discover collections” cards. Without any, the shop shows one tile per category.
- **Full-width banners**: wide photos between product rows.
- **Announcement bar**: short messages in the blue bar at the top (several rotate).
Each can link to any page (e.g. `/shop/tees`, `/product/after-hours-oversized-tee`, `/shop?sale=1`), be switched off, and be scheduled with a start and end time. Until you add hero slides, the home page shows a brand panel with your latest pieces.

## Inventory
All sizes in one table. Filter *Low*, *Sold out* or *People waiting*, search, change **Stock** or **Alert at**, press Save (or Enter). When a sold-out size goes above zero, everyone waiting gets an email straight away. “Held” = pieces in shoppers' checkouts right now (released after 15 minutes if they don't pay).

## Orders
New orders arrive as **New (paid)**. Move them along: Packed → Shipped (the customer gets a “shipped” email) → Delivered. **Details** shows the full address, phone and email, and the customer's **journey**: where they came from, which pieces they looked at, colours and sizes they tried, and every step to payment.
Cancelling or refunding before shipping puts the pieces back in stock. Refund the money itself in the Razorpay dashboard.

## Categories
Add, rename, reorder or hide categories (they show as shop filters and in the footer).

## Alerts
Running low, sold out, more than 10 shoppers waiting for one design, new orders, restock emails sent, account-deletion requests. They're also emailed to the address in Settings.

## Settings
Alert email(s), the “shoppers waiting” threshold (10), default running-low level, new-order emails, free-shipping threshold and fee, how long stock is held during payment, product music volume.

## Download data
Re-enter your password, pick dates, and download CSVs for **Orders**, **Customers**, **Shopper activity** (the raw journey data) and **Inventory**. Names, emails, phones, addresses, age and gender are decrypted in these files, so treat them carefully: keep them off shared drives and email, and delete them when done. Every download is logged.

## Account deletion requests
When a customer asks to be deleted you get an alert. Within 30 days: Supabase → Authentication → Users → find the email → Delete user. Their account, saved address, bag and reminders are removed; their past orders stay for your tax records but their personal details can no longer be decrypted.
