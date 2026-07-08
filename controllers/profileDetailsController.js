const profileDetails = require('../models/profileDetails');
const authorizeAction = require('../utils/authorizeAction');
const { uploadToS3, getS3KeyFromUrl } = require('../utils/s3Uploader');
const { deleteFilesFromS3 } = require('../utils/deleteFilesFromS3');
const bucketName = process.env.AWS_BUCKET_NAME;

exports.updateProfile = async (req, res) => {
  const userId = req.user?.id;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ status: false, message: 'Invalid User ID' });
  }

  try {
    const {
      phone_number,
      city,
      date_of_birth,
      office_address,
      home_address,
      gender // ✅ Added gender
    } = req.body;

    let profile_image = null;

    // First check if user_details entry exists
    profileDetails.getProfileOtherDetails(userId, async (err, existingUser) => {
      if (err) {
        console.error('MySQL error:', err);
        return res.status(500).json({ status: false, message: 'Internal server error' });
      }
      // If no profile exists, create it
      if (!existingUser) {
        return profileDetails.createDetails(userId, (createErr) => {
          if (createErr) {
            return res.status(500).json({ status: false, message: 'Error creating profile details' });
          }
          // Retry after creation
          return exports.updateProfile(req, res);
        });
      }

      // Authorization
      authorizeAction(profileDetails, userId, userId, {
        getMethod: 'getProfileIdforAuth',
        ownerField: 'id'
      }, async (authError) => {
        if (authError) {
          return res.status(authError.code).json({ status: false, message: authError.message });
        }

        try {
          // Handle profile image upload
          if (req.file) {
            if (existingUser.profile_image) {
              const oldKey = getS3KeyFromUrl(existingUser.profile_image);
              if (oldKey) await deleteFilesFromS3([oldKey], bucketName);
            }

            profile_image = await uploadToS3(req.file, 'profile_image');
          }

          // Prepare data for update
          const updateData = {
            phone_number,
            city,
            date_of_birth,
            office_address,
            home_address,
            gender // ✅ Added gender for users table
          };

          if (profile_image) {
            updateData.profile_image = profile_image;
          }

          // Perform the update
          profileDetails.updateProfileDetails(userId, updateData, (updateErr, result) => {
            if (updateErr) {
              console.error('MySQL update error:', updateErr);
              return res.status(500).json({ status: false, message: 'Internal server error' });
            }

            // ✅ Check if anything actually updated in either table
            const userAffected = result.userUpdate?.affectedRows || 0;
            const detailsAffected = result.detailUpdate?.affectedRows || 0;

            if (userAffected === 0 && detailsAffected === 0) {
              return res.status(200).json({ status: true, message: 'No changes provided.' });
            }

            // Fetch updated profile to return
            profileDetails.getProfileDetails(userId, (fetchErr, updatedProfile) => {
              if (fetchErr) {
                return res.status(500).json({
                  status: false,
                  message: 'Profile updated, but failed to retrieve updated data.'
                });
              }

              return res.status(200).json({
                status: true,
                message: 'Profile updated successfully.',
                updatedProfile
              });
            });
          });
        } catch (e) {
          console.error('Unexpected error:', e);
          return res.status(500).json({ status: false, message: 'Something went wrong' });
        }
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ status: false, message: 'Unexpected server error' });
  }
};


exports.getProfileDetails = (req, res) => {
  const user_id = req.user?.id;

  if (!user_id || isNaN(user_id)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  profileDetails.getProfileDetails(user_id, (err, profile) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (!profile) {
      return res.status(404).json({ status: false, message: 'profile not found for this user' });
    }

    return res.status(200).json({
      status: true,
      message: 'profile fetched successfully.',
      profile
    });
  });
};


exports.getBankDetails = (req, res) => {
  const user_id = req.user?.id;

  if (!user_id || isNaN(user_id)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  profileDetails.getBankDetails(user_id, (err, bankDetails) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (!bankDetails) {
      return res.status(404).json({ status: false, message: 'Bank Details not found for this user' });
    }

    return res.status(200).json({
      status: true,
      message: 'Bank Details fetched successfully.',
      bankDetails
    });
  });
};

exports.updateBankDetails = async (req, res) => {
  const userId = req.user?.id;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ status: false, message: 'Invalid User ID' });
  }

  try {
    const {
      bank_name,
      branch_location,
      account_holder_name,
      account_number,
      ifsc_code
    } = req.body;

    // Check if bank details already exist for the user
    profileDetails.getBankDetails(userId, async (err, existingDetails) => {
      if (err) {
        console.error('MySQL error:', err);
        return res.status(500).json({ status: false, message: 'Internal server error' });
      }
      // If no record, create an empty one and retry
      if (!existingDetails) {
        return profileDetails.createBankDetails(userId, (createErr) => {
          if (createErr) {
            return res.status(500).json({ status: false, message: 'Error creating bank details' });
          }
          // Retry after creation
          return exports.updateBankDetails(req, res);
        });
      }

      // Authorization (optional, same user ID check)
      authorizeAction(profileDetails, userId, userId, {
        getMethod: 'getBankDetailsForAuth',
        ownerField: 'user_id'
      }, async (authError) => {
        if (authError) {
          return res.status(authError.code).json({ status: false, message: authError.message });
        }

        try {
          const { razorpay_contact_id, razorpay_fund_account_id } = req.body;

          const updateData = {
            bank_name,
            branch_location,
            account_holder_name,
            account_number,
            ifsc_code
          };

          // Reset fund account cache if bank details changed
          if (existingDetails && (
            existingDetails.account_number !== account_number ||
            existingDetails.ifsc_code !== ifsc_code ||
            existingDetails.account_holder_name !== account_holder_name
          )) {
            updateData.razorpay_fund_account_id = null;
          } else if (razorpay_fund_account_id !== undefined) {
            updateData.razorpay_fund_account_id = razorpay_fund_account_id;
          }

          if (razorpay_contact_id !== undefined) {
            updateData.razorpay_contact_id = razorpay_contact_id;
          }

          // Perform the update
          profileDetails.updateBankDetails(userId, updateData, (updateErr, result) => {
            if (updateErr) {
              console.error('Update error:', updateErr);
              return res.status(500).json({ status: false, message: 'Failed to update bank details' });
            }

            if (result.affectedRows === 0) {
              return res.status(200).json({ status: true, message: 'No changes were made.' });
            }

            // Return updated data
            profileDetails.getBankDetails(userId, (fetchErr, updatedDetails) => {
              if (fetchErr) {
                return res.status(500).json({
                  status: false,
                  message: 'Updated, but failed to retrieve latest bank details.'
                });
              }

              return res.status(200).json({
                status: true,
                message: 'Bank details updated successfully.',
                updatedDetails
              });
            });
          });

        } catch (e) {
          console.error('Unexpected error:', e);
          return res.status(500).json({ status: false, message: 'Something went wrong' });
        }
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ status: false, message: 'Unexpected server error' });
  }
};

exports.getUserProfileDetails = (req, res) => {
  const user_id = req.user?.id;

  if (!user_id || isNaN(user_id)) {
    return res.status(400).json({ status: false, message: 'Invalid seller ID' });
  }

  profileDetails.getUserProfileDetails(user_id, (err, profile) => {
    if (err) {
      console.error('MySQL error:', err);
      return res.status(500).json({ status: false, message: 'Internal server error' });
    }

    if (!profile) {
      return res.status(404).json({ status: false, message: 'profile not found for this user' });
    }

    return res.status(200).json({
      status: true,
      message: 'profile fetched successfully.',
      profile
    });
  });
};

exports.updateUserProfile = async (req, res) => {
  const userId = req.user?.id;

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ status: false, message: 'Invalid User ID' });
  }

  try {
    const {
      phone_number,
      date_of_birth,
      gender,
      email,
      first_name,
      last_name,
      city,
      street,
      postal_code,
      country,
      state,
      address_id
    } = req.body;

    let profile_image = null;

    // First check if user_details entry exists
    profileDetails.getUserProfileDetails(userId, async (err, existingUserDetails) => {

      // Authorization
      authorizeAction(profileDetails, userId, userId, {
        getMethod: 'getProfileIdforAuth',
        ownerField: 'id'
      }, async (authError) => {
        if (authError) {
          return res.status(authError.code).json({ status: false, message: authError.message });
        }

        try {
          // Handle profile image upload
          if (req.file) {
            if (existingUserDetails.profile_image) {
              const oldKey = getS3KeyFromUrl(existingUserDetails.profile_image);
              if (oldKey) await deleteFilesFromS3([oldKey], bucketName);
            }

            profile_image = await uploadToS3(req.file, 'profile_image');
          }

          // Prepare data for update
          const updateData = {
            phone_number,
            date_of_birth,
            gender,
            email,
            first_name,
            last_name,
            city,
            street,
            postal_code,
            country,
            state,
            address_id
          };

          if (profile_image) {
            updateData.profile_image = profile_image;
          }

          // Perform the update
          profileDetails.updateUserProfileDetails(userId, updateData, (updateErr, result) => {
            if (updateErr) {
              console.error('MySQL update error:', updateErr);
              return res.status(500).json({ status: false, message: 'Internal server error' });
            }

            // ✅ Check if anything actually updated in either table
            const userAffected = result.userUpdate?.affectedRows || 0;
            const profileAffected = result.profileUpdate?.affectedRows || 0;
            const addressAffected = result.addressUpdate?.affectedRows || 0;

            if (userAffected === 0 && profileAffected === 0 && addressAffected === 0) {
              return res.status(200).json({
                status: true,
                message: 'No changes provided.'
              });
            }

            // Fetch updated profile to return
            profileDetails.getUserProfileDetails(userId, (fetchErr, updatedProfile) => {
              if (fetchErr) {
                return res.status(500).json({
                  status: false,
                  message: 'Profile updated, but failed to retrieve updated data.'
                });
              }

              return res.status(200).json({
                status: true,
                message: 'Profile updated successfully.',
                updatedProfile
              });
            });
          });
        } catch (e) {
          console.error('Unexpected error:', e);
          return res.status(500).json({ status: false, message: 'Something went wrong' });
        }
      });
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return res.status(500).json({ status: false, message: 'Unexpected server error' });
  }
};