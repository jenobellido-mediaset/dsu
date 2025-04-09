import React from 'react';
import { View, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';


const SplashScreen = () => {
  return (
    <View style={styles.container}>
      {/* Logo placeholder */}
      <Image
        source={{ uri: 'https://media.licdn.com/dms/image/v2/C4E0BAQFMevZrgQYnmA/company-logo_200_200/company-logo_200_200/0/1630604780441/mediaset_as_logo?e=1748476800&v=beta&t=TVK5_69HoYisDR7C1ZUZLNOALUcFkRSjGOkwiodwhe4' }}
        style={styles.logo}
      />
      <Text style={styles.title}>Mediaset Digital Signage</Text>
      <Text style={styles.version}>v1.2.3 © 2024 Mediaset AS</Text>
      {/* Loading UI */}
      <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" />
      </View>
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25293c',
  },
  logo: {
    width: 100, // Adjust size as needed
    height: 100, // Adjust size as needed
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'normal',
    marginBottom: 10,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
    fontFamily: 'Poppins',
  },
  version: {
    fontSize: 10,
    color: '#ffffff', // Adjust the color to match your design
    position: 'absolute',
    bottom: 5 ,
    right: 5,
    fontFamily: 'Poppins',
  },
  loadingContainer: {
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },


});


export default SplashScreen;

