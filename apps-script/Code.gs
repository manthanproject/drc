/**
 * DRC Uploader — runs as warhawkchaos@gmail.com.
 * Only job: hand the DRC server a short-lived Drive token, if it presents the shared secret.
 * It never touches PackingCam, DROPPY master or storage scripts.
 */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('DRC_TOKEN');
    if (!expected || body.token !== expected) {
      out = { ok: false, error: 'unauthorized' };
    } else if (body.action === 'token') {
      out = { ok: true, accessToken: ScriptApp.getOAuthToken(), account: Session.getEffectiveUser().getEmail() };
    } else {
      out = { ok: false, error: 'unknown action' };
    }
  } catch (err) {
    out = { ok: false, error: String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to grant Drive access. */
function authorize() {
  DriveApp.getRootFolder();
  Logger.log('Authorized as ' + Session.getEffectiveUser().getEmail());
}
