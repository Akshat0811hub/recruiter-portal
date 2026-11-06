# Google Apps Script — Optional Google Sheets Backup

Optional cloud backup configuration for mirroring leads to Google Sheets.

## Setup
1. Create a new spreadsheet at [sheets.new](https://sheets.new).
2. Open **Extensions -> Apps Script**, paste the contents of `google-apps-script/Code.gs`, and save.
3. Run the `setupSheets` function once and grant permissions to initialize the `Master_Leads` and `Recruiters` tabs.
4. Click **Deploy -> New deployment -> Web app** (`Execute as: Me`, `Who has access: Anyone`) to generate the webhook URL.
