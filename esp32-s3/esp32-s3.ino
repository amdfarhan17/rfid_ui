#include <WiFi.h>
#include <WebServer.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

//================= WIFI =================
const char* ssid = "a";
const char* password = "30052005f";

//=============== RC522 (SPI) ==================
// ESP32-S3-N16R8 note: GPIO 33-37 are reserved for octal PSRAM/flash
// on N16R8 boards, and GPIO 0/3/45/46 are strapping pins. Pins below
// avoid all of those and are safe general-purpose pins on most S3
// dev boards. Adjust if your specific board silkscreen differs.

#define SCK_PIN   12
#define MISO_PIN  13
#define MOSI_PIN  11
#define SS_PIN    10   // RC522 SDA/SS
#define RST_PIN   9    // RC522 RST

MFRC522 rfid(SS_PIN, RST_PIN);

//================ LED ===================
#define LED_PIN 8   // Many ESP32-S3 boards have an onboard LED on GPIO2/8/48;
                     // change to 2 or 48 if that's what your board uses.

WebServer server(80);

//=========== OPERATOR DATABASE ==========
const int NUM_OPERATORS = 4;

String operatorUIDs[NUM_OPERATORS] = {
  "50C06F1E",   // Card 1
  "73793706",   // Card 2
  "459AF605",   // Card 3
  "7A42F505"    // Card 4
};

String operatorNames[NUM_OPERATORS] = {
  "Farhan",
  "Parvez",
  "Nayaz",
  "Pariya"
};

String operatorIDs[NUM_OPERATORS] = {
  "OP001",
  "OP002",
  "OP003",
  "OP004"
};

//============== SESSION DATA ============
bool loggedIn = false;

String currentUID = "";
String operatorName = "";
String operatorId = "";

String machineName = "CNC Machine";
String machineId = "CNC-01";
String machineStatus = "Idle";
String shift = "Morning";

unsigned long loginMillis = 0;

//========================================

void handleStatus() {

  StaticJsonDocument<512> doc;

  doc["active"] = loggedIn;
  doc["operator_name"] = operatorName;
  doc["operator_id"] = operatorId;
  doc["machine_name"] = machineName;
  doc["machine_id"] = machineId;
  doc["machine_status"] = machineStatus;
  doc["shift"] = shift;
  doc["uid"] = currentUID;

  if (loggedIn)
    doc["session_seconds"] =
      (millis() - loginMillis) / 1000;
  else
    doc["session_seconds"] = 0;

  String response;
  serializeJson(doc, response);

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", response);
}

//========================================

void handleLogout() {

  loggedIn = false;
  currentUID = "";
  operatorName = "";
  operatorId = "";
  machineStatus = "Idle";

  digitalWrite(LED_PIN, LOW);

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "text/plain", "Logged Out");

  Serial.println("Logged Out");
}

//========================================

void setup() {

  Serial.begin(115200);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // RFID - explicit SPI pin mapping required on ESP32-S3
  SPI.begin(SCK_PIN, MISO_PIN, MOSI_PIN, SS_PIN);
  rfid.PCD_Init();

  Serial.println("RFID Reader Ready");
  Serial.println("Scan Card...");

  // WiFi
  WiFi.begin(ssid, password);

  Serial.print("Connecting WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // API
  server.on("/status", HTTP_GET, handleStatus);
  server.on("/logout", HTTP_GET, handleLogout);
  server.on(
    "/",
    HTTP_OPTIONS,
    []() {
        server.sendHeader("Access-Control-Allow-Origin", "*");
        server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        server.sendHeader("Access-Control-Allow-Headers", "*");
        server.send(204);
    }
);

  server.begin();

  Serial.println("HTTP Server Started");
}

//========================================

void loop() {

  server.handleClient();

  if (!rfid.PICC_IsNewCardPresent())
    return;

  if (!rfid.PICC_ReadCardSerial())
    return;

  String uid = "";

  for (byte i = 0; i < rfid.uid.size; i++) {

    if (rfid.uid.uidByte[i] < 0x10)
      uid += "0";

    uid += String(rfid.uid.uidByte[i], HEX);
  }

  uid.toUpperCase();

  Serial.print("Card UID: ");
  Serial.println(uid);

  // Find Operator
  int operatorIndex = -1;

  for (int i = 0; i < NUM_OPERATORS; i++) {

    if (uid == operatorUIDs[i]) {
      operatorIndex = i;
      break;
    }
  }

  // Valid Card
  if (operatorIndex != -1) {

    // Login
    if (!loggedIn) {

      loggedIn = true;

      currentUID = uid;
      operatorName = operatorNames[operatorIndex];
      operatorId = operatorIDs[operatorIndex];

      machineStatus = "Running";

      loginMillis = millis();

      digitalWrite(LED_PIN, HIGH);

      Serial.println("===== LOGIN SUCCESS =====");
      Serial.println("Operator: " + operatorName);
      Serial.println("ID: " + operatorId);
      Serial.println("========================");
    }

    // Logout if same card scanned again
    else if (uid == currentUID) {

      loggedIn = false;

      currentUID = "";
      operatorName = "";
      operatorId = "";

      machineStatus = "Idle";

      digitalWrite(LED_PIN, LOW);

      Serial.println("===== LOGOUT SUCCESS =====");
    }

    // Another operator tries while one is active
    else {

      Serial.println("Another operator already logged in");
    }
  }

  // Invalid Card
  else {

    Serial.println("ACCESS DENIED");

    for (int i = 0; i < 3; i++) {
      digitalWrite(LED_PIN, HIGH);
      delay(100);
      digitalWrite(LED_PIN, LOW);
      delay(100);
    }
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  delay(300);
}
