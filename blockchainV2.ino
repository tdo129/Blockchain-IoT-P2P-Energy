#include <WiFi.h>
#include <WiFiManager.h>
#include <Wire.h>
#include <Adafruit_INA219.h>
#include <LiquidCrystal_I2C.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h> 

// ================= CẤU HÌNH HỆ THỐNG =================
const char* mqtt_server = "broker.hivemq.com";
const int   mqtt_port = 1883;
WiFiClient espClient;
PubSubClient client(espClient);


const String FIREBASE_URL = "https://blockchain-6d10b-default-rtdb.asia-southeast1.firebasedatabase.app";

// Cấu hình thời gian NTP (Giờ Việt Nam UTC+7)
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 7 * 3600; 
const int   daylightOffset_sec = 0;

// ================= CẤU HÌNH PHẦN CỨNG =================
// 1. INA219 
Adafruit_INA219 ina219_phat(0x40);    // Module 1 (Nguồn phát - Ps)
Adafruit_INA219 ina219_tieuthu(0x41); // Module 2 (Tải tiêu thụ - Pl)

// 2. LCD 16x02
LiquidCrystal_I2C lcd(0x27, 16, 2); 

// 3. Relay (Kích mức LOW)
#define RELAY1_PIN  4   // Tải nội bộ (Quạt/LED)
#define RELAY2_PIN  25  // Lưới P2P (Bán điện)

// 4. Cảm biến Nhiệt độ 
#define DHTPIN 14
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

#define ONE_WIRE_BUS 27
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);

// ================= BIẾN TOÀN CỤC & MUTEX =================
unsigned long sample_id = 1;

float v_solar = 0.0, i_solar = 0.0, p_solar = 0.0;
float v_load = 0.0,  i_load = 0.0,  p_load = 0.0;
float temp_env = 0.0, hum_env = 0.0, temp_panel = 0.0;
float p_du = 0.0;

bool trade_active = false;

SemaphoreHandle_t dataMutex;

// ================= HÀM CALLBACK MQTT NHẬN LỆNH =================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }
  Serial.print("Lenh Smart Contract: ");
  Serial.println(msg);

  if (msg == "TRADE_SUCCESS") {
    trade_active = true;
  }
  else if (msg == "CUT_POWER") {
    digitalWrite(RELAY1_PIN, HIGH); // Ngắt tải
  }
  else if (msg == "RESTORE_POWER") {
    digitalWrite(RELAY1_PIN, LOW);  // Mở lại tải
  }
}

// ================= TASK 1: ĐỌC CẢM BIẾN (Mỗi 500ms) =================
void TaskSensor(void *pvParameters) {
  for (;;) {
    // Đo nguồn phát 
    float v1 = ina219_phat.getBusVoltage_V();
    float i1 = ina219_phat.getCurrent_mA();
    float p1 = ina219_phat.getPower_mW();

    // Đo tải tiêu thụ
    float v2 = ina219_tieuthu.getBusVoltage_V();
    float i2 = ina219_tieuthu.getCurrent_mA();
    float p2 = ina219_tieuthu.getPower_mW();

    // Đo môi trường
    float h = dht.readHumidity();
    float t = dht.readTemperature();
    ds18b20.requestTemperatures(); 
    float tp = ds18b20.getTempCByIndex(0);

    // Cập nhật dữ liệu vào biến toàn cục qua Mutex
    if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
      v_solar = v1; i_solar = i1; p_solar = p1 / 1000.0;
      v_load  = v2; i_load  = i2; p_load  = p2 / 1000.0;
      
      p_du = p_solar - p_load;
      
      if (!isnan(h) && !isnan(t)) {
        temp_env = t; hum_env = h;
      }
      if (tp != DEVICE_DISCONNECTED_C) {
        temp_panel = tp;
      }
      xSemaphoreGive(dataMutex);
    }
    vTaskDelay(500 / portTICK_PERIOD_MS);
  }
}

// ================= TASK 2: HIỂN THỊ & ĐIỀU KHIỂN (Mỗi 500ms) =================
void TaskDisplay(void *pvParameters) {
  for (;;) {
    float lp_sol, lp_lod, lp_du;
    
    if (xSemaphoreTake(dataMutex, portMAX_DELAY)) {
      lp_sol = p_solar; lp_lod = p_load; lp_du = p_du;
      xSemaphoreGive(dataMutex);
    }

    lcd.setCursor(0, 0);
    lcd.printf("Ps:%.2f Pl:%.2f  ", lp_sol, lp_lod);
    
    lcd.setCursor(0, 1);
    if (lp_du > 0.05) {
      lcd.printf("Pdu:+%.2f SELL ", lp_du);
    } else if (lp_du < -0.05) {
      lcd.printf("Pdu:%.2f BUY   ", lp_du);
    } else {
      lcd.printf("Pdu:0.00 BAL   ");
    }

    if (trade_active) {
      lcd.setCursor(12, 1);
      lcd.print("P2P!");
      digitalWrite(RELAY2_PIN, LOW); 
      vTaskDelay(2000 / portTICK_PERIOD_MS); 
      digitalWrite(RELAY2_PIN, HIGH); 
      lcd.setCursor(12, 1);
      lcd.print("    "); 
      trade_active = false;
    }

    vTaskDelay(500 / portTICK_PERIOD_MS);
  }
}

// ================= TASK 3: MQTT & ĐẨY DỮ LIỆU JSON =================
void TaskMQTT(void *pvParameters) {
  for (;;) {
    if (WiFi.status() == WL_CONNECTED) {
      if (!client.connected()) {
        String clientId = "ESP32SmartEnergy-" + String(random(0, 1000));
        if (client.connect(clientId.c_str())) {
          client.subscribe("p2p/smart_contract"); 
        }
      } else {
        client.loop();

        static unsigned long lastMsg = 0;
        unsigned long now = millis();
        
        if (now - lastMsg > 15000) { 
          lastMsg = now;
          
          float t_v_sol, t_i_sol, t_p_sol, t_v_lod, t_i_lod, t_p_lod;
          float t_env, t_pan, irradiance;
          
          if (xSemaphoreTake(dataMutex, (TickType_t)10)) {
            t_v_sol = v_solar; t_i_sol = i_solar; t_p_sol = p_solar;
            t_v_lod = v_load;  t_i_lod = i_load;  t_p_lod = p_load;
            t_env = temp_env;  t_pan = temp_panel;
            xSemaphoreGive(dataMutex);
          }

          irradiance = (t_p_sol / 3.0) * 1000.0;

          if (isnan(t_v_sol)) t_v_sol = 0.0;
          if (isnan(t_i_sol)) t_i_sol = 0.0;
          if (isnan(t_p_sol)) t_p_sol = 0.0;
          if (isnan(t_v_lod)) t_v_lod = 0.0;
          if (isnan(t_i_lod)) t_i_lod = 0.0;
          if (isnan(t_p_lod)) t_p_lod = 0.0;
          if (isnan(irradiance)) irradiance = 0.0;
          if (isnan(t_env)) t_env = 0.0;
          if (isnan(t_pan)) t_pan = 0.0;

          struct tm timeinfo;
          char timeStringBuff[30];
          if(!getLocalTime(&timeinfo)){
            strcpy(timeStringBuff, "N/A"); 
          } else {
            strftime(timeStringBuff, sizeof(timeStringBuff), "%Y-%m-%d %H:%M:%S", &timeinfo);
          }

          char msg[400];
          snprintf(msg, sizeof(msg), 
            "{\"metadata\":{\"sample_id\":%lu,\"timestamp\":\"%s\"},"
            "\"electrical\":{\"v_solar\":%.2f,\"i_solar\":%.2f,\"p_solar\":%.2f,\"v_load\":%.2f,\"i_load\":%.2f,\"p_load\":%.2f},"
            "\"environment\":{\"irradiance\":%.1f,\"temp_panel\":%.1f,\"temp_ambient\":%.1f}}",
            sample_id, timeStringBuff, 
            t_v_sol, t_i_sol, t_p_sol, t_v_lod, t_i_lod, t_p_lod, 
            irradiance, t_pan, t_env);
          
          client.publish("p2p/sensor_data", msg);
          Serial.println(msg);

          WiFiClientSecure secureClient;
          secureClient.setInsecure(); 
          
          HTTPClient http;
          
          // --- THƯ MỤC 1: Lịch sử dữ liệu vĩnh viễn (POST) ---
          String url_history = FIREBASE_URL + "/sensor_data_history.json";
          http.begin(secureClient, url_history); 
          http.addHeader("Content-Type", "application/json");
          int httpCode1 = http.POST(msg); 
          http.end();

          // --- THƯ MỤC 2: Bộ đệm 10 mẫu gần nhất cho AI (PUT xoay vòng) ---
          // Thuật toán chia lấy dư: Mẫu 1 vào record_0, Mẫu 10 vào record_9, Mẫu 11 đè lên record_0
          int recent_index = (sample_id - 1) % 10; 
          String url_recent = FIREBASE_URL + "/sensor_data_recent/record_" + String(recent_index) + ".json";
          
          http.begin(secureClient, url_recent);
          http.addHeader("Content-Type", "application/json");
          int httpCode2 = http.PUT(msg); 
          http.end();
          
          if (httpCode1 > 0 && httpCode2 > 0) {
            Serial.printf("-> Firebase OK | History: %d | Recent(Vi tri %d): %d\n", httpCode1, recent_index, httpCode2);
          } else {
            Serial.printf("-> Firebase Loi | History: %d | Recent: %d\n", httpCode1, httpCode2);
          }
          
          sample_id++; 
        }
      }
    }
    vTaskDelay(50 / portTICK_PERIOD_MS);
  }
}

// ================= SETUP HỆ THỐNG CỐT LÕI =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- KHOI DONG HE THONG P2P ENERGY ---");
  
  Wire.begin(); 

  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, HIGH); 
  digitalWrite(RELAY2_PIN, HIGH); 

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Bat WiFi tren DT");
  lcd.setCursor(0, 1);
  lcd.print("Ket noi: ESP_P2P");

  WiFiManager wm;
  bool res = wm.autoConnect("ESP_P2P"); 
  if(!res) {
    Serial.println("Loi ket noi WiFi, dang Reset...");
    ESP.restart(); 
  } 

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WiFi Connected!");
  Serial.println("WiFi Connected!");
  delay(1000);

  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  dht.begin();
  ds18b20.begin();
  
  if (!ina219_phat.begin()) {
    Serial.println("Loi: Thieu INA219 Nguon phat (0x40)");
  }
  if (!ina219_tieuthu.begin()) {
    Serial.println("Loi: Thieu INA219 Tai tieu thu (0x41)");
  }

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(mqttCallback);

  digitalWrite(RELAY1_PIN, LOW); 

  dataMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(TaskSensor,  "Sensor",  4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskDisplay, "Display", 4096, NULL, 1, NULL, 1);
  xTaskCreatePinnedToCore(TaskMQTT,    "MQTT",    8192, NULL, 1, NULL, 0); 
}

void loop() {
  vTaskDelete(NULL); 
}