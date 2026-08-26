import SafeScreen from '@/components/SafeScreen';
import { router, useLocalSearchParams } from 'expo-router';
import { View, Text, TouchableOpacity } from 'react-native';

const ProductDetailScreen = () => {
  const { id } = useLocalSearchParams();

  return (
    <SafeScreen>
      <View>
        <Text className='text-white'>Product Id: {id}</Text>
        <TouchableOpacity
          className='bg-primary rounded-2xl px-6 py-3 mt-6'
          onPress={() => router.back()}
        >
          <Text className='text-white text-center'>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeScreen>
  );
};

export default ProductDetailScreen;