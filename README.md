# Ocellus

A STAR voting ballot generator, scanner, and tabulator for small clubs and organizations. Design an election on your phone, print scantron-style paper ballots, scan them back in with the camera, and get verifiable results.

## What it does

* **Election design.** Add races with candidates (scored 0 to 5, STAR voting) and yes/no questions with a configurable pass threshold (majority, 2/3, or 3/4). Candidate order can be randomized per ballot.
* **Ballot printing.** Ballots look like scantrons and print from the browser, or save as PDF. Every ballot carries a unique code (serial plus a cryptographic MAC on the election's secret key) and a QR code, so only ballots printed for this election can be scanned, no ballot can be counted twice, and any ballot can be spoiled by its code.
* **Camera scanning.** Point the camera at a ballot page. The app finds the QR code, verifies the ballot, locates the registration marks, reads the bubbles, and shows you what it read for confirmation before recording. Faint or double marks get flagged. Ballots can also be entered or spoiled by hand using the printed code.
* **Teamwork.** Elections and scan results both export as plain text strings you can paste into any chat (Signal, email, whatever). One person can design, another print, and several people can scan, then merge their work.
* **Results.** Full STAR tallies (score round plus automatic runoff), question outcomes, a plain-language summary, and an Election Integrity Code: a short code that comes out identical for every official whose data agrees, regardless of scan order, duplicate scans, or who spoiled which ballot.

## Running it

It is a static web app with no build step. Serve the directory over HTTP and open it:

```
npm run serve
```

Then visit http://localhost:8080. Camera access requires HTTPS or localhost. To use it on an Android phone against a dev machine, either use `adb reverse tcp:8080 tcp:8080` and open localhost on the phone, or host the files somewhere with HTTPS. It installs as a PWA and works offline after the first load.

## Tests

```
npm test
```

The test suite covers the ballot code cryptography, STAR tallies and tie handling, record merging, the integrity code, page layout, and the optical scanner run against synthetically rendered ballot photos (skewed, rotated, noisy, and faintly marked).

## Vendored libraries

* [jsQR](https://github.com/cozmo/jsQR) (MIT) for QR decoding.
* [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) for QR encoding.
