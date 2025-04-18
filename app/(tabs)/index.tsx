import { StyleSheet, View, Text, Image, Dimensions } from 'react-native';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import uuid from 'react-native-uuid';
import React, { useState, useEffect, useRef} from 'react';
import axios from 'axios';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';
import io, { Socket } from 'socket.io-client';
import { Platform } from 'react-native';
import * as Network from 'expo-network';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { DeviceType } from 'expo-device';
import { Alert } from 'react-native';
import SplashScreen from './components/splash-screen';
import * as ExpoSplashScreen from 'expo-splash-screen';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

function getDeviceTypeString(deviceType: DeviceType | null): string {
  switch (deviceType) {
    case DeviceType.PHONE:
      return 'PHONE';
    case DeviceType.TABLET:
      return 'TABLET';
    case DeviceType.DESKTOP:
      return 'DESKTOP';
    case DeviceType.TV:
      return 'TV';
    case DeviceType.UNKNOWN:
      return 'UNKNOWN';
    default:
      return 'NOT AVAILABLE';
  }
}


interface DeviceInfo {
  ipAddress?: string | null;
  deviceType?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  model?: string | null;
  totalStorage?: number | null;
  freeStorage?: number | null;
  location?: { latitude: number | null, longitude: number | null } | null;
}


function generatePairingCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}


export default function HomeScreen() {
  const [deviceId, setDeviceId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceStatus, setDeviceStatus] = useState({ registered: false, linked: false });
  const [isAppReady, setIsAppReady] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(true);
  const router = useRouter();
  const socketRef = React.useRef<Socket | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({});

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setIsConnected(state.isConnected);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  async function fetchDeviceInfo() {
    // Permissions
    const { status } = await Location.requestForegroundPermissionsAsync();


    // Fetching device and network information
    const ipAddress = await Network.getIpAddressAsync();
    const deviceType = getDeviceTypeString(Device.deviceType);
    const osName = Device.osName;
    const osVersion = Device.osVersion;
    const model = Device.modelName;
    const totalStorage = await FileSystem.getTotalDiskCapacityAsync();
    const freeStorage = await FileSystem.getFreeDiskStorageAsync();
   
    let location = null;
    if (status === 'granted') {
      location = await Location.getCurrentPositionAsync({});
    }
    setDeviceInfo({
      ipAddress,
      deviceType,
      osName: osName || '',
      osVersion: osVersion || '',
      model: model || '',
      totalStorage,
      freeStorage,
      location: location ? { latitude: location.coords.latitude, longitude: location.coords.longitude } : null
    });
  }
 
  // WebSocket connection to the server
  useEffect(() => {
    socketRef.current = io('https://staging.service.dscdn.salext.net/screen-socket', {
      transports: ['websocket'],
    });


    socketRef.current.connect();
    socketRef.current.on('connect', () => {
      console.log('Connected to WebSocket server for screen connection.');
    });


    socketRef.current.on('consoleLinkedScreen', (data) => {
      console.log('Received consoleLinkedScreen event with data:', data);
      if (data.identifier === deviceId) {
        console.log('Console linked to screen');
        checkDeviceStatus();
      }
    });


  }, [deviceId]);
 
  async function getDeviceId() {
    let deviceId = await SecureStore.getItemAsync('deviceId');
    console.log(deviceId);
   
    if (!deviceId) {
      deviceId = String(uuid.v4());
      await SecureStore.setItemAsync('deviceId', deviceId);
    }
 
    return deviceId;
  }


  useEffect(() => {
    async function updateDeviceInfo() {
      if (deviceId) {
        await fetchDeviceInfo();
      }
    }
    updateDeviceInfo();
  }, [deviceId]);

  const checkDeviceStatus = async () => {
    if (deviceId) {
    try {
      console.log("Checking device status for", deviceId);
      const response = await axios.get(`https://staging.service.dscdn.salext.net/screen/get-by-identifier/${deviceId}`);
      console.log("Device status", response.data);
      setDeviceStatus({ registered: true, linked: response.data.linked });
      setPairingCode(response.data.pairingCode);
    } catch (error) {
      registerDevice();
    }
    }
  };
 
  const registerDevice = async () => {
    console.log("registerDevice", deviceId, deviceInfo.ipAddress);
    const newPairingCode = generatePairingCode();
    setPairingCode(newPairingCode);
    try {
      const response = await axios.post('https://staging.service.dscdn.salext.net/screen/add-screen', {
        name: deviceInfo.osName && deviceInfo.model ? `${deviceInfo.osName} ${deviceInfo.model}` : 'Unknown Device',
        identifier: deviceId,
        isVirtual: false,
        ipAddress: deviceInfo.ipAddress ?? '',
        deviceType: deviceInfo.deviceType ?? 'UNKNOWN',
        osName: deviceInfo.osName ?? '',
        osVersion: deviceInfo.osVersion ?? '',
        modelName: deviceInfo.model ?? '',
        totalStorage: deviceInfo.totalStorage ?? 0,
        freeStorage: deviceInfo.freeStorage ?? 0,
        location: deviceInfo.location ?? null,
        pairingCode: newPairingCode
      });
      // alert('Device registered successfully!');
      setDeviceStatus({ registered: true, linked: false });
    } catch (error) {
      Alert.alert(
        "Error",
        `Failed to register device: ${error}`,
        [{ text: "OK" }]
      );
      console.error(error);
    }  
  };

  useEffect(() => {
    async function prepare() {
      try {
        await ExpoSplashScreen.preventAutoHideAsync();
       
        async function loadDeviceIdAndCheckStatus() {
          const id = await getDeviceId();
          setDeviceId(id);
        }
        loadDeviceIdAndCheckStatus();        


        await Promise.all([
          checkDeviceStatus(),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
       
        setIsAppReady(true);
      } catch (e) {
        Alert.alert(
          "Error",
          `An error occurred during preparation: ${e}`,
          [{ text: "OK" }]
        );
        console.warn(e);
      } finally {
        await ExpoSplashScreen.hideAsync();
      }
    }


    prepare();
  }, [deviceInfo]);


  useEffect(() => {
    if (deviceStatus.registered && deviceStatus.linked && isAppReady) {
      router.push('/explore');
    }
  }, [deviceStatus, router, isAppReady]);


  if (!isAppReady) {
    return <SplashScreen />;
  }

  if (!isConnected) {
    return (
      <View style={styles.container}>
        <View style={styles.offlineContainer}>
          <Text style={styles.offlineText}>No Internet Connection</Text>
          <Text style={styles.offlineSubText}>Please check your connection and try again</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {deviceStatus.registered && !deviceStatus.linked && (
        <View style={styles.contentContainer}>
          {/* Left side - QR Code */}
          <View style={styles.qrContainer}>
            <View style={styles.qrCode}>
              <QRCode
                value={`https://staging.console.dscdn.salext.net/screen/${deviceId}`}
                size={180}
                backgroundColor="white"
              />
            </View>
            <Text style={styles.infoText}>
              If you cannot scan the QR code,{'\n'}use the 6-digit code below to link your device manually:
            </Text>
            <Text style={styles.deviceIdText}>{pairingCode}</Text>
          </View>


          {/* Right side - Device Info */}
          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>Device Information</Text>
            <View style={styles.infoContent}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Device Type:</Text>
                <Text style={styles.infoValue}>{deviceInfo.deviceType}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Model:</Text>
                <Text style={styles.infoValue}>{deviceInfo.model}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>OS:</Text>
                <Text style={styles.infoValue}>{`${deviceInfo.osName} ${deviceInfo.osVersion}`}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>IP Address:</Text>
                <Text style={styles.infoValue}>{deviceInfo.ipAddress}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Storage:</Text>
                <Text style={styles.infoValue}>
                  {`${((deviceInfo.freeStorage ?? 0) / 1024 / 1024 / 1024).toFixed(2)}GB free of ${((deviceInfo.totalStorage ?? 0) / 1024 / 1024 / 1024).toFixed(2)}GB`}
                </Text>
              </View>
              {deviceInfo.location && (
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Location:</Text>
                  <Text style={styles.infoValue}>
                    {`${(deviceInfo.location.latitude ?? 0).toFixed(6)}, ${(deviceInfo.location.longitude ?? 0).toFixed(6)}`}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#25293c',
    padding: 16,
  },
  contentContainer: {
    flex: 1,
    flexDirection: 'row',
    maxHeight: '100%',
  },
  qrContainer: {
    flex: 0.45,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#2f3042',
    paddingRight: 16,
    paddingVertical: 16,
  },
  qrCode: {
    backgroundColor: 'white',
    padding: 8,
    borderRadius: 8,
  },
  infoContainer: {
    flex: 0.5,
    paddingLeft: 16,
    paddingVertical: 16,
    
  },
  infoContent: {
    flex: 1,
    justifyContent: 'center',
  },
  infoText: {
    color: 'white',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    fontFamily: 'Poppins',
    fontSize: 13,
    lineHeight: 18,
  },
  deviceIdText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    padding: 8,
    borderWidth: 1,
    borderColor: 'white',
    borderRadius: 5,
    fontFamily: 'Poppins',
  },
  infoTitle: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    fontFamily: 'Poppins',
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  infoLabel: {
    color: '#8f9ab7',
    width: 100,
    fontFamily: 'Poppins',
    fontSize: 13,
  },
  infoValue: {
    color: 'white',
    flex: 1,
    fontFamily: 'Poppins',
    fontSize: 13,
  },
  offlineContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#25293c',
  },
  offlineText: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    fontFamily: 'Poppins',
  },
  offlineSubText: {
    color: '#8f9ab7',
    fontSize: 16,
    textAlign: 'center',
    fontFamily: 'Poppins',
  },
});
