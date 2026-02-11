
import axios from 'axios';

const BASE_URL = 'http://localhost:3000/v1/users';
const TEST_USER = {
    Webuddy_name: 'test_verify_' + Date.now(),
    name: 'Verification User'
};

async function run() {
    try {
        // 1. Create User
        console.log('1. Creating User...');
        const createRes = await axios.post(BASE_URL, TEST_USER);
        if (createRes.status !== 201) throw new Error('Failed to create user');
        console.log('User created:', createRes.data);

        const createdUser = createRes.data;
        if (createdUser.Webuddy_name !== TEST_USER.Webuddy_name) {
            throw new Error('Webuddy_name mismatch in creation response');
        }

        // 2. Get User by Webuddy_name
        console.log('2. Fetching User by Webuddy_name...');
        const getRes = await axios.get(`${BASE_URL}/${TEST_USER.Webuddy_name}`);
        if (getRes.status !== 200) throw new Error('Failed to get user');
        console.log('User fetched:', getRes.data);
        if (getRes.data.id !== createdUser.id) throw new Error('ID mismatch');

        // 3. Update User by Webuddy_name
        console.log('3. Updating User by Webuddy_name...');
        const updatePayload = { name: 'Updated Name' };
        const updateRes = await axios.patch(`${BASE_URL}/${TEST_USER.Webuddy_name}`, updatePayload);
        if (updateRes.status !== 200) throw new Error('Failed to update user');
        console.log('User updated:', updateRes.data);
        if (updateRes.data.name !== 'Updated Name') throw new Error('Name not updated');

        console.log('SUCCESS: All checks passed!');
    } catch (error) {
        console.error('FAILURE:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

run();
