import { useState, useEffect, useRef } from 'react';
import { View, Image, Text, StyleSheet, AppState, Animated, ActivityIndicator } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import uuid from 'react-native-uuid';
import io, { Socket } from 'socket.io-client';
import { useFocusEffect } from '@react-navigation/native';
import React from 'react';
import * as Animatable from 'react-native-animatable'; 
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';

interface PlaylistItem {
  id: number;
  mediaId: number;
  userId: number;
  folderId: number;
  filename: string;
  localMediaPath: string;
  s3MediaPath: string;
  mediaType: string;
  uploadDate: string;
  fileSize: number;
  duration: number;
  resolution: string;
  tag: string;
  availableFrom: string;
  expiration: string;
  position: number;
  playlistId: number;
  transition: string; // "Push" or "Fade"
}

const Explore = () => {
  const [deviceId, setDeviceId] = useState('');
  const [playlistItems, setPlaylistItems] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [mediaUrls, setMediaUrls] = useState<{ [key: string]: string }>({});
  const [connectionStatus, setConnectionStatus] = useState(false);
  const socketRef = React.useRef<Socket | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [notification, setNotification] = useState({ message: '', visible: false });
  const fadeAnim = useRef(new Animated.Value(0)).current;  // Initial value for opacity: 0
  const router = useRouter();
  const [backgroundColor, setBackgroundColor] = useState<string>('black');

  // New state variables for loading and error
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<{ generalError: string | null, technicalError: string | null, errorCode: string | null }>({
    generalError: null,
    technicalError: null,
    errorCode: null
  });

  const [downloadProgress, setDownloadProgress] = useState<{ [key: number]: number }>({});
  const [downloadingItems, setDownloadingItems] = useState<number[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const fetchedDeviceId = await SecureStore.getItemAsync('deviceId');
        setDeviceId(fetchedDeviceId || '');
        console.log("deviceId", fetchedDeviceId);
        if (!fetchedDeviceId) {
          setIsLoading(false);
        }
      } catch (err) {  
        console.log("Error fetching deviceId:", err);
      }
    };
    fetchData();
    setIsLoading(true);
    setError({ generalError: null, technicalError: null, errorCode: null });
  }, []);

  useEffect(() => {
    const fetchAssignedPlaylist = async () => {
      console.log("fetchAssignedPlaylist: ", deviceId);
      if (deviceId) {
        try {
          // Get screen details by deviceId
          const response = await axios.get(`https://staging.service.dscdn.salext.net/screen/get-by-identifier/${deviceId}`);
          const screen = response.data;
          setBackgroundColor(screen.backgroundColor || 'black');

          // Get screen content by screen ID
          const screenContentResponse = await axios.get(`https://staging.service.dscdn.salext.net/screen/get-screen-content-by-screen/${screen.id}`);
          let screenContent = screenContentResponse.data;

          // If there's no screen content, clear the playlist items and return
          if (!screenContent || screenContent.length === 0) {
            setPlaylistItems([]);
            setCurrentIndex(0);
            setError({ generalError: null, technicalError: null, errorCode: null });
            setIsLoading(false);
            return;
          }

          // Sort screen content by position
          screenContent = screenContent.sort((a: any, b: any) => a.position - b.position);

          let currentPosition = 1;  
          const allPlaylistItems: PlaylistItem[] = [];

          // Loop through screen content
          for (const content of screenContent) {
            if (content.contentType === 'playlist') {
              try {
                const playlistResponse = await axios.get(`https://staging.service.dscdn.salext.net/playlist/${content.contentId}`);
                if (playlistResponse.data.status.toLowerCase() !== 'enabled') {
                  continue;
                }
                const playlistId = playlistResponse.data.id;

                // Check if the playlist is on schedule
                const scheduleResponse = await axios.get(`https://staging.service.dscdn.salext.net/playlist/playlist-schedules/is-playlist-in-schedule/${playlistId}`);
                const isOnSchedule = scheduleResponse.data;

                if (isOnSchedule) {
                  const playlistMediaResponse = await axios.get(`https://staging.service.dscdn.salext.net/playlist-media/by-playlist/${playlistId}`);

                  // If there's no media in the playlist, continue to next content
                  if (!playlistMediaResponse.data || playlistMediaResponse.data.length === 0) {
                    continue;
                  }

                  // Sort playlist media by position
                  playlistMediaResponse.data.sort((a: any, b: any) => a.position - b.position);

                  // Loop through the playlist media and fetch details for each item
                  for (const playlistItem of playlistMediaResponse.data) {
                    try {
                      const mediaResponse = await axios.get(`https://staging.service.dscdn.salext.net/media/${playlistItem.mediaId}`);
                      allPlaylistItems.push({
                        ...mediaResponse.data,
                        id: playlistItem.id,
                        duration: playlistItem.duration,
                        mediaId: mediaResponse.data.id,
                        position: currentPosition,
                        playlistId: playlistId,
                        transition: playlistResponse.data.transition
                      });
                      currentPosition++;
                    } catch (mediaError) {
                      console.error(`Error fetching media with ID ${playlistItem.mediaId}:`, mediaError);
                      setError({
                        generalError: `Error fetching media with ID ${playlistItem.mediaId}`,
                        technicalError: `${mediaError}`,
                        errorCode: `${(mediaError as any).status}`
                      });

                      // Update the screen's status
                      await axios.patch(`https://staging.service.dscdn.salext.net/screen/update-by-identifier`, {
                        identifier: deviceId,
                        status: "error",
                        statusDescription: `[${(mediaError as any).status}] Error fetching media with ID ${playlistItem.mediaId}`
                      })
                    }
                  }
                }
              } catch (playlistError) {
                console.error(`Error fetching playlist with ID ${content.contentId}:`, playlistError);
                setError({
                  generalError: `Error fetching playlist with ID ${content.contentId}`,
                  technicalError: `${playlistError}`,
                  errorCode: `${(playlistError as any).status}`
                });

                // Update the screen's status
                await axios.patch(`https://staging.service.dscdn.salext.net/screen/update-by-identifier`, {
                  identifier: deviceId,
                  status: "error",
                  statusDescription: `[${(playlistError as any).status}] Error fetching playlist with ID ${content.contentId}`
                })
              }
            }
          }

          // Check and update playlist items if unscheduled
          const updatedPlaylistItems = await updatePlaylistItemsIfUnscheduled(allPlaylistItems);

          // If there are no valid playlist items after checking schedules, clear the playlist
          if (updatedPlaylistItems.length === 0) {
            setPlaylistItems([]);
            setCurrentIndex(0);
            setError({ generalError: null, technicalError: null, errorCode: null });
            setIsLoading(false);
            return;
          }

          // Check if there are changes before updating state
          if (JSON.stringify(updatedPlaylistItems) !== JSON.stringify(playlistItems)) {
            setPlaylistItems(updatedPlaylistItems);
         
            // Adjust currentIndex if necessary
            if (currentIndex >= updatedPlaylistItems.length) {
              setCurrentIndex(updatedPlaylistItems.length - 1 >= 0 ? updatedPlaylistItems.length - 1 : 0);
            }
          }

          // Update the screen's contentVersion in the database
          await axios.patch(`https://staging.service.dscdn.salext.net/screen/update-by-identifier`, {
            identifier: deviceId,
            contentVersion: 1,
          })
         
        } catch (error) {
          console.log("Error fetching playlist:", error);
          setError({
            generalError: `Failed to fetch content.`,
            technicalError: `${error}`,
            errorCode: `${(error as any).status}`  
          });
          // Update the screen's status
          await axios.patch(`https://staging.service.dscdn.salext.net/screen/update-by-identifier`, {
            identifier: deviceId,
            status: "error",
            statusDescription: `[${(error as any).status}] Failed to fetch content.`
          })
         
        } finally {
          setIsLoading(false);
        }
      }
    };

    const intervalId = setInterval(() => {
      if (deviceId) {
        fetchAssignedPlaylist();
      }
    }, 5000);  

    // Cleanup interval on component unmount
    return () => clearInterval(intervalId);
  }, [deviceId, playlistItems, currentIndex]);

  useEffect(() => {
    console.log("playlistItems", playlistItems);
    playlistItems.forEach(item => {
      fetchMediaUrl(item.mediaId)
    });
  }, [playlistItems]);
 


  // Function to check and update playlist items if unscheduled
  const updatePlaylistItemsIfUnscheduled = async (allPlaylistItems: PlaylistItem[]) => {
    try {
      const updatedPlaylistItems = [];
      let currentPosition = 1;


      for (const item of allPlaylistItems) {
        try {
          const scheduleResponse = await axios.get(`https://staging.service.dscdn.salext.net/playlist/playlist-schedules/is-playlist-in-schedule/${item.playlistId}`);
          const isOnSchedule = scheduleResponse.data;


          if (isOnSchedule) {
            updatedPlaylistItems.push({ ...item, position: currentPosition });
            currentPosition++;
          }
        } catch (scheduleError) {
          console.error(`Error checking schedule for playlistId ${item.playlistId}:`, scheduleError);
          // Optionally, you can continue or handle the error accordingly
          setError({
            generalError: `Error checking schedule for playlist ID ${item.playlistId}`,
            technicalError: `${scheduleError}`,
            errorCode: `${(scheduleError as any).status}`
          });    
        }
      }


      return updatedPlaylistItems;
    } catch (err) {
      console.error("Error in updatePlaylistItemsIfUnscheduled:", err);
      setError({
        generalError: `Error in checking and updating playlist items.`,
        technicalError: `${err}`,
        errorCode: `${(err as any).status}`
      });
      // Update the screen's status
      await axios.patch(`https://staging.service.dscdn.salext.net/screen/update-by-identifier`, {
        identifier: deviceId,
        status: "error",
        statusDescription: `[${(err as any).status}] Error in checking and updating playlist items.`
      })
      throw err;
    }
  };


  const fetchMediaUrl = async (mediaId: number) => {
    try {
      // Check if file exists in cache
      const cacheDir = FileSystem.cacheDirectory;
      const fileName = `media_${mediaId}`;
      const filePath = `${cacheDir}${fileName}`;
      
      // Try to read from cache first
      const fileInfo = await FileSystem.getInfoAsync(filePath);
      
      if (fileInfo.exists) {
        setMediaUrls(prev => ({ ...prev, [mediaId]: filePath }));
        return;
      }

      // If not in cache, download and save
      setDownloadingItems(prev => [...prev, mediaId]);
      setDownloadProgress(prev => ({ ...prev, [mediaId]: 0 }));

      const s3Response = await axios.get(`https://staging.service.dscdn.salext.net/storage/media/${mediaId}/get-s3-media`);
      const s3Url = s3Response.data.s3Path;
      
      if (s3Url) {
        // Download and save to cache with progress tracking
        const downloadResult = await FileSystem.createDownloadResumable(
          s3Url,
          filePath,
          {},
          (downloadProgress) => {
            const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
            setDownloadProgress(prev => ({ ...prev, [mediaId]: progress }));
          }
        ).downloadAsync();

        if (downloadResult?.status === 200) {
          setMediaUrls(prev => ({ ...prev, [mediaId]: downloadResult.uri }));
          setDownloadingItems(prev => prev.filter(id => id !== mediaId));
          setDownloadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[mediaId];
            return newProgress;
          });
          return;
        }
      }
    } catch (s3Error) {
      console.log('Error fetching S3 media:', s3Error);
      try {
        setDownloadingItems(prev => [...prev, mediaId]);
        setDownloadProgress(prev => ({ ...prev, [mediaId]: 0 }));

        const localResponse = await axios.get(`https://staging.service.dscdn.salext.net/storage/media/${mediaId}/get-local-media`, {
          responseType: 'blob',
        });
        
        // Save blob to cache
        const cacheDir = FileSystem.cacheDirectory;
        const fileName = `media_${mediaId}`;
        const filePath = `${cacheDir}${fileName}`;
        
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(localResponse.data);
        });

        if (typeof base64Data === 'string') {
          await FileSystem.writeAsStringAsync(filePath, base64Data);
          setMediaUrls(prev => ({ ...prev, [mediaId]: filePath }));
          setDownloadingItems(prev => prev.filter(id => id !== mediaId));
          setDownloadProgress(prev => {
            const newProgress = { ...prev };
            delete newProgress[mediaId];
            return newProgress;
          });
        }
      } catch (localError) {
        console.log('Error fetching local media:', localError);
        setDownloadingItems(prev => prev.filter(id => id !== mediaId));
        setDownloadProgress(prev => {
          const newProgress = { ...prev };
          delete newProgress[mediaId];
          return newProgress;
        });
        // Only set error if we don't have a cached version
        if (!mediaUrls[mediaId]) {
          setError({
            generalError: `Error fetching media asset.`,
            technicalError: `${localError}`,
            errorCode: `${(localError as any).status}`
          });
        }
      }
    }
  };


  useEffect(() => {
    let timer: NodeJS.Timeout;


    if (playlistItems.length > 0 && playlistItems[currentIndex]) {
      timer = setInterval(() => {
        setCurrentIndex((prevIndex) => {
          if (prevIndex + 1 < playlistItems.length) {
            return prevIndex + 1;
          } else {
            return 0; // Loop back to start
          }
        });
      }, playlistItems[currentIndex].duration * 1000); // Assuming duration is in seconds
    }


    return () => {
      if (timer) clearInterval(timer);
    };
  }, [playlistItems, currentIndex]);


  useFocusEffect(
    React.useCallback(() => {
      const socket = io('https://staging.service.dscdn.salext.net/screen-socket', {
        transports: ['websocket'],
      });
      socketRef.current = socket;
      socket.on('connect', () => {
        console.log('WebSocket connected');
        setConnectionStatus(true);
        if (deviceId && error.generalError === null && error.technicalError === null && error.errorCode === null) {

          // First, perform a GET request to fetch userId
          axios.get(`https://staging.service.dscdn.salext.net/screen/get-by-identifier/${deviceId}`)
            .then(response => {
              const userId = response.data.userId; // Assuming the response contains userId
              // Now send a POST request with the required data
              if (userId) { // Check if userId is present
                axios.post(`https://staging.service.dscdn.salext.net/screen-analytics`, {
                  screenId: deviceId,
                  userId: userId,
                  status: 'online',
                  date: new Date().toUTCString() 
                })
                .then(postResponse => {
                  console.log('Data posted successfully:', postResponse.data);
                })
                .catch(postError => {
                  console.error('Error posting data:', postError);
                setError({
                  generalError: 'Failed to post screen analytics data',
                  technicalError: postError.message,
                  errorCode: postError.response ? postError.response.status : 'Unknown'
                });
                });
              }
            })
            .catch(error => {
              console.error('Error fetching userId:', error);
              setError({
                generalError: 'Failed to fetch userId',
                technicalError: error.message,
                errorCode: error.response ? error.response.status : 'Unknown'
              });
            });
        }
        socket.emit('playStatus', { deviceId });
      });

      socket.on('consoleUnlinkedScreen', (data) => {
        console.log('Received consoleUnlinkedScreen event with data:', data);
        if (data.identifier === deviceId) {
          console.log('Console linked to screen');
          router.push('/');
        }
      });

      socket.on('connectionStatus', (data) => {
        setConnectionStatus(data.connected);
        if (data.connected && error.generalError === null && error.technicalError === null && error.errorCode === null) {
          // First, perform a GET request to fetch userId
          axios.get(`https://staging.service.dscdn.salext.net/screen/get-by-identifier/${deviceId}`)
          .then(response => {
            const userId = response.data.userId; // Assuming the response contains userId
            // Now send a POST request  the required data
            if (userId) { // Check if userId is present
              axios.post(`https://staging.service.dscdn.salext.net/screen-analytics`, {
                screenId: deviceId,
                userId: userId,
                status: 'online',
                date: new Date().toUTCString() // Sending current date-time in UTC format
              })
              .then(postResponse => {
                console.log('Data posted successfully:', postResponse.data);
              })
              .catch(postError => {
                console.error('Error posting data:', postError);
              setError({
                generalError: 'Failed to post screen analytics data',
                technicalError: postError.message,
                errorCode: postError.response ? postError.response.status : 'Unknown'
              });
              });
            }
          })
          .catch(error => {
            console.error('Error fetching userId:', error);
            setError({
              generalError: 'Failed to fetch userId',
              technicalError: error.message,
              errorCode: error.response ? error.response.status : 'Unknown'
            });
          });
        } else {
          console.log("error", error);
        }
      });


      socket.on('sendNotification', (data) => {
        try {
          console.log("sendNotification", data);
          if (data.identifier === deviceId) {
            console.log("sendNotification executed", data);
            setNotification({ message: data.notification, visible: true });
          }
        } catch (notificationError) {
          console.error("Error handling sendNotification:", notificationError);
        }
      });


      // Handle connection close
      socket.on('disconnect', () => {
        try {
          if (deviceId && error.generalError === null && error.technicalError === null && error.errorCode === null) {
              axios.patch(`https://staging.service.dscdn.salext.net/screen/update-by-identifier`, {
                identifier: deviceId,
                status: 'offline'
              })
          }
          socket.emit('playStatus', { deviceId });


          console.log('WebSocket disconnected');
          setConnectionStatus(false);
        } catch (disconnectError) {
          console.error("Error handling disconnect:", disconnectError);
        }
      });

      socket.on('checkScreenStatus', async (data) => {
        if (data.identifier === deviceId) {
          try {
            // Get current screen details including contentVersion
            const response = await axios.get(`https://staging.service.dscdn.salext.net/screen/get-by-identifier/${deviceId}`);
            const screen = response.data;
           
            // Determine status based on priority: error > out_of_sync > online
            let status = 'online';
            if (error.generalError || error.technicalError || error.errorCode) {
              status = 'error';
            } else if (screen.contentVersion === 0) {
              status = 'out_of_sync';
            }

            // Respond with current status
            const statusResponse = {
              identifier: deviceId,
              status: status,
              errorMessage: error.generalError || error.technicalError,
              contentVersion: screen.contentVersion
            };
            socket.emit('screenStatusResponse', statusResponse);
          } catch (err) {
            console.error('Error checking screen status:', err);
            setError({
              generalError: 'Failed to fetch screen details',
              technicalError: (err as any).message,
              errorCode: (err as any).response ? (err as any).response.status : 'Unknown'
            });
          }
        }
      });

      // Add background color change listener
      socket.on('backgroundColorChanged', (data) => {
        if (data.identifier === deviceId) {
          setBackgroundColor(data.backgroundColor || 'black');
        }
      });

      const connectionCheckInterval = setInterval(() => {
        socket.emit('checkConnection');
      }, 5000);

      return () => {
        clearInterval(connectionCheckInterval);
        socket.emit('playStatus', { deviceId });
        socket.disconnect();
      };
    }, [deviceId, playlistItems]) // Added dependencies
  );
 
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (appState.match(/inactive|background/) && nextAppState === 'active') {
          console.log('App has come to the foreground!', deviceId);
          if (deviceId && error.generalError === null && error.technicalError === null && error.errorCode === null) {
            socketRef.current?.emit('playStatus', { deviceId });

          // First, perform a GET request to fetch userId
          axios.get(`https://staging.service.dscdn.salext.net/screen/get-by-identifier/${deviceId}`)
          .then(response => {
            const userId = response.data.userId; // Assuming the response contains userId
            // Now send a POST request with the required data
            if (userId) { // Check if userId is present
              axios.post(`https://staging.service.dscdn.salext.net/screen-analytics`, {
                screenId: deviceId,
                userId: userId,
                status: 'online',
                date: new Date().toUTCString() // Sending current date-time in UTC format
              })
              .then(postResponse => {
                console.log('Data posted successfully:', postResponse.data);
              })
              .catch(postError => {
                console.error('Error posting data:', postError);
              setError({
                generalError: 'Failed to post screen analytics data',
                technicalError: postError.message,
                errorCode: postError.response ? postError.response.status : 'Unknown'
              });
              });
            }
          })
          .catch(error => {
            console.error('Error fetching userId:', error);
            setError({
              generalError: 'Failed to fetch userId',
              technicalError: error.message,
              errorCode: error.response ? error.response.status : 'Unknown'
            });
          });
          }
      } else if (nextAppState === 'background') {
        console.log('App has gone to the background!');
        if (deviceId && error.generalError === null && error.technicalError === null && error.errorCode === null) {
          socketRef.current?.emit('playStatus', { deviceId});
        }
      }
      setAppState(nextAppState);
    });

    return () => {
      subscription.remove();
    };
  }, [appState, deviceId, playlistItems]);

  useEffect(() => {
    if (notification.visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true
      }).start(() => {
        setTimeout(() => {
          Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 500,
            useNativeDriver: true
          }).start(() => setNotification({ message: '', visible: false }));
        }, 5000);
      });
    }
  }, [notification.visible]);

  return (
    <View style={[styles.container, { backgroundColor: backgroundColor }]}>
      <View style={styles.statusIndicator}>
        <View style={{ width: 5, height: 5, borderRadius: 5, backgroundColor: connectionStatus ? 'green' : 'red' }} />
      </View>

      {isLoading ? (
        // Loading UI
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Loading content...</Text>
        </View>
      ) : error.errorCode && error.generalError && error.technicalError && playlistItems.length === 0 ? (
        // Error UI - Only show if we have no playlist items
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error.generalError}</Text>
          <Text style={styles.errorText}>{error.technicalError}</Text>
          <Text style={styles.errorCode}> Error code: {error.errorCode}</Text>
        </View>
      ) : playlistItems.length > 0 ? (
        // Content UI
        <>
          {playlistItems[currentIndex] && (
            <Animatable.View
              animation={
                playlistItems[currentIndex].transition === "Fade In" ? "fadeIn" :
                playlistItems[currentIndex].transition === "Fade In Right" ? "fadeInRight" :
                playlistItems[currentIndex].transition === "Fade In Left" ? "fadeInLeft" :
                playlistItems[currentIndex].transition === "Slide In Up" ? "slideInUp" :
                playlistItems[currentIndex].transition === "Slide In Down" ? "slideInDown" :
                playlistItems[currentIndex].transition === "Slide In Left" ? "slideInLeft" :
                playlistItems[currentIndex].transition === "Slide In Right" ? "slideInRight" :
                "fadeIn"
              }
              duration={1500}
              style={styles.mediaContainer}
              key={playlistItems[currentIndex].id}
            >
              {playlistItems[currentIndex].mediaType.startsWith('video') ? (
                <Video
                  source={{ uri: mediaUrls[playlistItems[currentIndex].mediaId] ?? '' }}
                  rate={1.0}
                  volume={1.0}
                  isMuted={false}
                  shouldPlay
                  resizeMode={ResizeMode.CONTAIN}
                  style={styles.media}
                  isLooping={true}
                  onError={(error) => {
                    console.error('Video playback error:', error);
                  }}
                />
              ) : (
                <Image
                  source={{ uri: mediaUrls[playlistItems[currentIndex].mediaId] || undefined }}
                  style={styles.media}
                  resizeMode="contain"
                  onError={(error) => {
                    console.error('Image loading error:', error);
                  }}
                />
              )}
            </Animatable.View>
          )}
          
          {/* Download Progress Overlay */}
          {downloadingItems.length > 0 && (
            <View style={styles.downloadProgressContainer}>
              {downloadingItems.map((mediaId) => (
                <View key={mediaId} style={styles.downloadProgressItem}>
                  <Text style={styles.downloadProgressText}>
                    Downloading media {mediaId}...
                  </Text>
                  <View style={styles.progressBarContainer}>
                    <View 
                      style={[
                        styles.progressBar,
                        { width: `${downloadProgress[mediaId] * 100}%` }
                      ]} 
                    />
                  </View>
                  <Text style={styles.downloadProgressPercentage}>
                    {Math.round(downloadProgress[mediaId] * 100)}%
                  </Text>
                </View>
              ))}
            </View>
          )}
        </>
      ) : (
        // Fallback UI if no playlist items
        <View style={styles.noContentContainer}>
          <Image
            source={{ uri: 'https://media.licdn.com/dms/image/v2/C4E0BAQFMevZrgQYnmA/company-logo_200_200/company-logo_200_200/0/1630604780441/mediaset_as_logo?e=1748476800&v=beta&t=TVK5_69HoYisDR7C1ZUZLNOALUcFkRSjGOkwiodwhe4' }}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.noContentText}>No content is currently assigned.</Text>
        </View>
      )}

      {notification.visible && (
        <Animated.View style={[styles.notification, { opacity: fadeAnim }]}>
          <Text style={styles.notificationText}>{notification.message} Updating screen content...</Text>
        </Animated.View>
      )}
    </View>
  );
};




export default Explore;


// Add styles for the loading UI
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mediaContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: {
    width: '100%',
    height: '100%',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#252a3d'
  },
  errorText: {
    color: 'red',
    fontSize: 14,
    textAlign: 'center',
  },
  errorCode: {
    color: 'grey',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  statusIndicator: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 1000,
  },
  notification: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(115, 103, 240, 0.8)', // Primary color with 80% opacity
    padding: 10,
    borderRadius: 5,
    zIndex: 1000,
    shadowColor: '#171717',
    shadowOffset: { width: -2, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  notificationText: {
    color: '#FFFFFF',
    fontSize: 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#252a3d'
  },
  loadingText: {
    color: '#fff',
    marginTop: 10,
    fontSize: 14,
  },
  noContentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#252a3d'
  },
  logo: {
    width: 200,
    height: 200,
    marginBottom: 20,
  },  
  noContentText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  downloadProgressContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 10,
    borderRadius: 5,
  },
  downloadProgressItem: {
    marginBottom: 10,
  },
  downloadProgressText: {
    color: '#fff',
    fontSize: 12,
    marginBottom: 5,
  },
  progressBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  downloadProgressPercentage: {
    color: '#fff',
    fontSize: 10,
    textAlign: 'right',
    marginTop: 2,
  },
});
